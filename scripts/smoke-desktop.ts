import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { startServer } from '../src/server-runtime.js';
import { identifyServer } from '../src/server-discovery.js';
import type { DesktopConfig } from '../desktop/config.js';

const bundle = resolve('release/Life Manager-darwin-arm64/Life Manager.app');
const executable = join(bundle, 'Contents/MacOS/Life Manager');
assert.equal(execFileSync('plutil', ['-extract', 'LSUIElement', 'raw', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(), 'true');
const directory = await mkdtemp(join(tmpdir(), 'life-manager-desktop-smoke-'));
console.log(`Temporary profile and logs: ${directory}`);
const dataDir = join(directory, 'workspace');
let child: ChildProcess | undefined;
let external: Awaited<ReturnType<typeof startServer>> | undefined;
let launchNumber = 0;

async function waitFor<T>(read: () => Promise<T>, description: string): Promise<T> {
  const deadline = Date.now() + 25_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${description}. ${lastError ?? ''}`);
}
async function launch(config: DesktopConfig) {
  const profile = join(directory, `profile-${++launchNumber}`);
  await mkdir(profile);
  await writeFile(join(profile, 'connection.json'), JSON.stringify(config));
  const env: NodeJS.ProcessEnv = { ...process.env, LIFE_MANAGER_DESKTOP_HOME: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  child = spawn(executable, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout!.on('data', data => { output += data; });
  child.stderr!.on('data', data => { output += data; });
  child.on('error', error => { output += error.message; });
  try {
    await waitFor(async () => {
      if (child!.exitCode !== null) throw new Error(`App exited: ${output}`);
      const log = await readFile(join(profile, 'desktop.log'), 'utf8');
      return log.includes('Workspace window loaded.') ? log : '';
    }, 'packaged workspace window load');
  } catch (error) { console.error(output); throw error; }
  return profile;
}
async function quit() {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => { running.kill('SIGKILL'); reject(new Error('Desktop did not quit cleanly.')); }, 10_000);
    running.once('exit', code => { clearTimeout(timer); code === 0 ? done() : reject(new Error(`Desktop exit code: ${code}`)); });
    running.kill('SIGTERM');
  });
}
const local: DesktopConfig = { mode: 'local', dataDir, port: 0, shareNetwork: false };
try {
  const first = await launch(local);
  const record = JSON.parse(await readFile(join(dataDir, '.server.json'), 'utf8'));
  assert.equal((await identifyServer(record.origin)).application, 'life-manager');
  assert.match(await readFile(join(first, 'desktop.log'), 'utf8'), /owned local server/);
  const events = await fetch(`${record.origin}/api/events`);
  const reader = events.body!.getReader();
  await reader.read();
  const response = await fetch(`${record.origin}/api/mutate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Manager': '1' },
    body: JSON.stringify({ command: { type: 'create', id: 'desktop-smoke', title: 'Desktop smoke item', parentId: 'build' } }),
  });
  assert.equal(response.status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: changed/);
  await reader.cancel();
  await quit();
  await assert.rejects(readFile(join(dataDir, '.server.json')));
  await assert.rejects(identifyServer(record.origin));
  console.log('PASS: packaged window loaded, API and live events work, Quit stops owned server.');

  await launch(local);
  const restarted = JSON.parse(await readFile(join(dataDir, '.server.json'), 'utf8'));
  const item = await (await fetch(`${restarted.origin}/api/items/desktop-smoke`)).json();
  assert.equal(item.item.title, 'Desktop smoke item');
  await quit();
  console.log('PASS: desktop restart preserves workspace.');

  external = await startServer({ dataDir, cwd: directory, publicDir: resolve('dist') });
  const attached = await launch(local);
  assert.match(await readFile(join(attached, 'desktop.log'), 'utf8'), /external server/);
  await quit();
  await identifyServer(external.origin);
  console.log('PASS: local directory attaches to its existing owner; Quit leaves it running.');

  await launch({ mode: 'remote', url: external.origin });
  await quit();
  await identifyServer(external.origin);
  console.log('PASS: explicit server connection loads; Quit leaves external server running.');
  await external.stop(); external = undefined;
  await rm(directory, { recursive: true, force: true });
  console.log('All packaged desktop smoke checks passed.');
} finally {
  await quit();
  await external?.stop();
}
