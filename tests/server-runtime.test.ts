import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { startServer, WorkspaceInUseError } from '../src/server-runtime';
import { discoverWorkspaceServer, identifyServer, validateServerConnection } from '../src/server-discovery';
import { parseConfig, externalLinkAllowed } from '../desktop/config';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'life-manager-runtime-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'public'));
  await writeFile(join(dir, 'public/index.html'), '<h1>Test workspace</h1>');
  return { dataDir: join(dir, 'data'), publicDir: join(dir, 'public'), cwd: dir };
}
async function serve(options: Parameters<typeof startServer>[0]) {
  const server = await startServer(options);
  cleanup.push(() => server.stop());
  return server;
}

describe('server lifecycle', () => {
  it('serves the UI, identifies its actual port and preserves data across restart', async () => {
    const options = await workspace();
    const server = await serve(options);
    expect(server.host).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
    expect(await identifyServer(server.origin)).toMatchObject({ application: 'life-manager', protocolVersion: 1 });
    expect(await discoverWorkspaceServer(options.dataDir)).toBe(server.origin);
    expect(await (await fetch(server.origin)).text()).toContain('Test workspace');
    const edited = await fetch(`${server.origin}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Manager': '1' }, body: JSON.stringify({ command: { type: 'create', id: 'desktop-test', title: 'Shared task', parentId: 'build' } }) });
    expect(edited.ok).toBe(true);
    await server.stop();
    expect(await discoverWorkspaceServer(options.dataDir)).toBeUndefined();
    const restarted = await serve(options);
    const item = await (await fetch(`${restarted.origin}/api/items/desktop-test`)).json();
    expect(item.item.title).toBe('Shared task');
  });

  it('refuses duplicate owners including directory aliases and verifies identity before attaching', async () => {
    const options = await workspace();
    const server = await serve(options);
    await expect(startServer(options)).rejects.toMatchObject({ origin: server.origin });
    const alias = join(options.cwd, 'alias');
    await symlink(options.dataDir, alias);
    await expect(startServer({ ...options, dataDir: alias })).rejects.toBeInstanceOf(WorkspaceInUseError);
    await writeFile(join(options.dataDir, '.server.json'), JSON.stringify({ origin: server.origin, instanceId: 'stale-owner' }));
    expect(await discoverWorkspaceServer(options.dataDir)).toBeUndefined();
    await expect(startServer(options)).rejects.toMatchObject({ origin: undefined });
  });

  it('releases ownership after failed startup and reclaims a stale crashed lock', async () => {
    const options = await workspace();
    const occupied = createServer();
    await new Promise<void>(done => occupied.listen(0, '127.0.0.1', done));
    cleanup.push(() => new Promise<void>(done => occupied.close(() => done())));
    const address = occupied.address() as { port: number };
    await expect(startServer({ ...options, port: address.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    const lock = join(options.dataDir, '.server.lock');
    await mkdir(lock);
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    const server = await serve(options);
    expect(await discoverWorkspaceServer(options.dataDir)).toBe(server.origin);
  });

  it('publishes changes to another client and terminates SSE on shutdown', async () => {
    const server = await serve(await workspace());
    const stream = await fetch(`${server.origin}/api/events`);
    const reader = stream.body!.getReader();
    await reader.read();
    await fetch(`${server.origin}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Manager': '1' }, body: JSON.stringify({ command: { type: 'create', id: 'from-browser', title: 'Browser edit', parentId: 'build' } }) });
    const update = new TextDecoder().decode((await reader.read()).value);
    expect(update).toContain('event: changed');
    await server.stop();
    expect((await reader.read()).done).toBe(true);
  });
});

describe('desktop connection boundaries', () => {
  it('connects to pre-desktop servers through the workspace API without weakening ownership checks', async () => {
    const server = await serve(await workspace());
    const legacy = createServer(async (request, response) => {
      if (request.url === '/api/workspace') {
        response.setHeader('Content-Type', 'application/json');
        response.end(await (await fetch(`${server.origin}/api/workspace`)).text());
      } else { response.writeHead(404); response.end('{"error":"No such API endpoint."}'); }
    });
    await new Promise<void>(done => legacy.listen(0, '127.0.0.1', done));
    cleanup.push(() => new Promise<void>(done => legacy.close(() => done())));
    const address = `http://127.0.0.1:${(legacy.address() as { port: number }).port}`;
    await expect(validateServerConnection(address)).resolves.toBeUndefined();
    await expect(identifyServer(address)).rejects.toThrow('HTTP 404');
  });

  it('reports the failing endpoint and rejects unrelated or malformed server responses', async () => {
    let body = '<html>Another app</html>';
    let status = 200;
    const server = createServer((_request, response) => { response.writeHead(status); response.end(body); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    cleanup.push(() => new Promise<void>(done => server.close(() => done())));
    const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await expect(validateServerConnection(address)).rejects.toThrow('did not return a Life Manager workspace');
    body = '{"dashboard":{},"periods":[]}';
    await expect(validateServerConnection(address)).rejects.toThrow('did not return a Life Manager workspace');
    status = 404;
    await expect(validateServerConnection(address)).rejects.toThrow(`${address}/api/workspace (HTTP 404)`);
  });

  it('validates local settings and canonicalizes server origins', () => {
    expect(parseConfig({ mode: 'local', dataDir: '/tmp/workspace', port: 0, shareNetwork: false })).toMatchObject({ port: 0 });
    expect(parseConfig({ mode: 'remote', url: 'https://example.test:443/' })).toEqual({ mode: 'remote', url: 'https://example.test' });
    for (const url of ['file:///tmp/a', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test/?a=b']) expect(() => parseConfig({ mode: 'remote', url })).toThrow();
    expect(() => parseConfig({ mode: 'local', dataDir: 'relative', port: 4317, shareNetwork: false })).toThrow();
    expect(() => parseConfig({ mode: 'local', dataDir: '/tmp/test', port: 65536, shareNetwork: false })).toThrow();
  });
  it('only permits supported external link protocols', () => {
    expect(externalLinkAllowed('codex://threads/new?prompt=hello')).toBe(true);
    expect(externalLinkAllowed('https://example.test')).toBe(true);
    expect(externalLinkAllowed('file:///etc/passwd')).toBe(false);
    expect(externalLinkAllowed('javascript:alert(1)')).toBe(false);
  });
});
