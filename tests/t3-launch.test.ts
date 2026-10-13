import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { launchT3Conversation } from '../src/t3-launch';

vi.mock('node:child_process', () => ({ execFile: vi.fn((_file, _args, _options, callback) => callback(null, '', '')) }));
vi.mock('node:fs/promises', () => ({ access: vi.fn().mockResolvedValue(undefined), stat: vi.fn().mockResolvedValue({}), readdir: vi.fn().mockResolvedValue(['T3 Code (Nightly)']) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('T3 conversation launcher', () => {
  it('uses a saved location in preference to environment configuration', async () => {
    vi.stubEnv('LIFE_MANAGER_T3_BIN', '/stale/t3');
    await launchT3Conversation('/workspace', '/custom/tools/t3');
    expect(execFile).toHaveBeenCalledWith('/custom/tools/t3', ['app', '/workspace'], expect.any(Object), expect.any(Function));
    await expect(launchT3Conversation('/workspace', 'relative/t3')).rejects.toThrow('absolute path');
    await expect(launchT3Conversation('/workspace', { path: '/tools/t3' })).rejects.toThrow('Invalid T3 Code location');
  });

  it.skipIf(process.platform !== 'darwin')('accepts a saved app bundle or its Finder executable path', async () => {
    vi.stubEnv('LIFE_MANAGER_T3_BIN', '/stale/t3');
    vi.stubEnv('LIFE_MANAGER_T3_APP', '/old/T3.app');
    for (const location of ['/Applications/T3 Code (Nightly).app', '/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)']) {
      await launchT3Conversation('/workspace', location);
      expect(execFile).toHaveBeenLastCalledWith('/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)',
        ['/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar/apps/server/dist/bin.mjs', 'app', '/workspace'], expect.any(Object), expect.any(Function));
    }
  });
  it('passes a directory as a literal argument with a GUI-safe environment', async () => {
    vi.stubEnv('LIFE_MANAGER_T3_BIN', '/tools/t3');
    vi.stubEnv('NODE_OPTIONS', '--import /some/loader.js');
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    vi.stubEnv('ELECTRON_NO_ASAR', '1');
    vi.stubEnv('PATH', '/usr/bin');
    const directory = '/workspace/space & $(literal)';
    await launchT3Conversation(directory);
    const [file, args, options] = vi.mocked(execFile).mock.calls[0]! as unknown as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }];
    expect(file).toBe('/tools/t3');
    expect(args).toEqual(['app', directory]);
    expect(options.cwd).toBe(directory);
    expect(options.env.PATH).toContain('/.local/bin');
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(options.env.ELECTRON_NO_ASAR).toBeUndefined();
    expect(readdir).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== 'darwin')('runs the CLI bundled in the macOS app without a PATH installation', async () => {
    vi.stubEnv('LIFE_MANAGER_T3_BIN', '');
    vi.stubEnv('LIFE_MANAGER_T3_APP', '/Applications/T3 Code (Nightly).app');
    await launchT3Conversation('/workspace');
    expect(access).toHaveBeenCalled();
    expect(stat).toHaveBeenCalledWith('/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar');
    expect(access).not.toHaveBeenCalledWith('/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar');
    expect(execFile).toHaveBeenCalledWith('/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)',
      ['/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar/apps/server/dist/bin.mjs', 'app', '/workspace'],
      expect.objectContaining({ env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }) }), expect.any(Function));
  });

  it('reports failure without retrying a possibly opened conversation', async () => {
    vi.stubEnv('LIFE_MANAGER_T3_BIN', '/tools/t3');
    vi.mocked(execFile).mockImplementationOnce(((_file: unknown, _args: unknown, _options: unknown, callback: Function) => callback(Object.assign(new Error('Timed out'), { killed: true }))) as never);
    await expect(launchT3Conversation('/workspace')).rejects.toThrow('Check T3 Code before trying again');
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('reports missing installations and rejects relative executable overrides', async () => {
    vi.stubEnv('LIFE_MANAGER_T3_BIN', '/missing/t3');
    vi.mocked(execFile).mockImplementationOnce(((_file: unknown, _args: unknown, _options: unknown, callback: Function) => callback(Object.assign(new Error('Missing'), { code: 'ENOENT' }))) as never);
    await expect(launchT3Conversation('/workspace')).rejects.toThrow('T3 Code was not found');
    vi.stubEnv('LIFE_MANAGER_T3_BIN', 't3');
    await expect(launchT3Conversation('/workspace')).rejects.toThrow('absolute executable path');
  });
});
