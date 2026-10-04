import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Both the standalone server and Electron main process launch on their own host. */
export async function launchT3Conversation(cwd: string): Promise<void> {
  if (!isAbsolute(cwd)) throw new Error('The T3 Code working directory must be an absolute path.');
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  env.PATH = [...new Set([...(env.PATH ?? '').split(delimiter), join(homedir(), '.local/bin'), join(homedir(), 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean))].join(delimiter);
  let executable = env.LIFE_MANAGER_T3_BIN || 't3';
  let args = ['app', cwd];
  if (env.LIFE_MANAGER_T3_BIN && !isAbsolute(env.LIFE_MANAGER_T3_BIN)) throw new Error('LIFE_MANAGER_T3_BIN must be an absolute executable path.');
  if (!env.LIFE_MANAGER_T3_BIN && process.platform === 'darwin') {
    const names = ['T3 Code (Nightly).app', 'T3 Code.app', 'T3 Code (Alpha).app'];
    const candidates = env.LIFE_MANAGER_T3_APP ? [env.LIFE_MANAGER_T3_APP]
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
        await access(archive);
        executable = binary;
        args = [join(archive, 'apps/server/dist/bin.mjs'), 'app', cwd];
        env.ELECTRON_RUN_AS_NODE = '1';
        break;
      } catch { /* Try the next standard installation location. */ }
    }
    if (env.LIFE_MANAGER_T3_APP && executable === 't3') throw new Error('Could not find a T3 Code executable in LIFE_MANAGER_T3_APP.');
  }
  try {
    // The CLI must acknowledge opening the draft. Never retry: a failed response
    // could follow a successful open, and retrying would create duplicate drafts.
    await run(executable, args, { cwd, env, timeout: 20_000, maxBuffer: 64 * 1024 });
  } catch (cause) {
    const error = cause as Error & { code?: string; stderr?: string; killed?: boolean };
    if (error.code === 'ENOENT') throw new Error('T3 Code was not found on this computer. Install T3 Code or set LIFE_MANAGER_T3_BIN to its CLI executable.');
    if (error.killed) throw new Error('T3 Code did not confirm opening a conversation. Check T3 Code before trying again.');
    throw new Error(`Could not open a T3 Code conversation. Make sure T3 Code is running on this computer. ${error.stderr?.trim().slice(0, 1500) || error.message}`);
  }
}
