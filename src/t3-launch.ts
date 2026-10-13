import { execFile } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Both the standalone server and Electron main process launch on their own host. */
export async function launchT3Conversation(cwd: string, location?: unknown): Promise<void> {
  if (location !== undefined && (typeof location !== 'string' || location.length > 4096 || location.includes('\0'))) throw new Error('Invalid T3 Code location.');
  let savedPath = (location as string | undefined)?.trim() ?? '';
  if (savedPath.startsWith('~/')) savedPath = join(homedir(), savedPath.slice(2));
  if (savedPath && !isAbsolute(savedPath)) throw new Error('T3 Code location must be an absolute path to the app bundle or CLI executable.');
  // Accept the app bundle itself or its executable when pasted from Finder.
  const bundlePath = savedPath.match(/^(.*\.app)(?:\/Contents\/MacOS\/[^/]+)?\/?$/)?.[1];
  if (bundlePath && process.platform !== 'darwin') throw new Error('T3 Code app bundles require macOS. Set the CLI executable path for this computer instead.');
  if (!isAbsolute(cwd)) throw new Error('The T3 Code working directory must be an absolute path.');
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  env.PATH = [...new Set([...(env.PATH ?? '').split(delimiter), join(homedir(), '.local/bin'), join(homedir(), 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean))].join(delimiter);
  const explicitBinary = savedPath ? (bundlePath ? undefined : savedPath) : env.LIFE_MANAGER_T3_BIN;
  const explicitBundle = savedPath ? bundlePath : env.LIFE_MANAGER_T3_APP;
  let executable = explicitBinary || 't3';
  let args = ['app', cwd];
  if (explicitBinary && !isAbsolute(explicitBinary)) throw new Error('LIFE_MANAGER_T3_BIN must be an absolute executable path.');
  if (!explicitBinary && process.platform === 'darwin') {
    const names = ['T3 Code (Nightly).app', 'T3 Code.app', 'T3 Code (Alpha).app'];
    const candidates = explicitBundle ? [explicitBundle]
      : ['/Applications', join(homedir(), 'Applications')].flatMap(directory => names.map(name => join(directory, name)));
    for (const bundle of candidates) {
      if (!isAbsolute(bundle)) throw new Error('LIFE_MANAGER_T3_APP must be an absolute app bundle path.');
      try {
        const macOS = join(bundle, 'Contents/MacOS');
        const entries = await readdir(macOS);
        if (entries.length !== 1) continue;
        const binary = join(macOS, entries[0]!);
        await access(binary, constants.X_OK);
        const archive = join(bundle, 'Contents/Resources/app.asar');
        // Electron exposes an ASAR root as a virtual directory: access() can
        // reject it even when present. stat() works in both Node and Electron.
        await stat(archive);
        executable = binary;
        args = [join(archive, 'apps/server/dist/bin.mjs'), 'app', cwd];
        env.ELECTRON_RUN_AS_NODE = '1';
        break;
      } catch (cause) {
        if (explicitBundle) throw new Error(`Could not read the T3 Code app at ${bundle}: ${(cause as Error).message}. Check Settings → Prompts → T3 Code location.`);
      }
    }
    if (explicitBundle && executable === 't3') throw new Error(`Could not read a T3 Code app at ${explicitBundle}. Check Settings → Prompts → T3 Code location.`);
  }
  try {
    // The CLI must acknowledge opening the draft. Never retry: a failed response
    // could follow a successful open, and retrying would create duplicate drafts.
    await run(executable, args, { cwd, env, timeout: 20_000, maxBuffer: 64 * 1024 });
  } catch (cause) {
    const error = cause as Error & { code?: string; stderr?: string; killed?: boolean };
    if (error.code === 'ENOENT') throw new Error(`T3 Code was not found at ${executable}. Set its app bundle or CLI executable in Settings → Prompts → T3 Code location.`);
    if (error.killed) throw new Error('T3 Code did not confirm opening a conversation. Check T3 Code before trying again.');
    throw new Error(`Could not open a T3 Code conversation. Make sure T3 Code is running on this computer. ${error.stderr?.trim().slice(0, 1500) || error.message}`);
  }
}
