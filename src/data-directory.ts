import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function resolveDataDirectory(projectDirectory: string, override?: string, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (override) return resolve(override);
  const legacy = resolve(projectDirectory, '.data');
  if (platform !== 'darwin') return legacy;
  const directory = resolve(home, 'Library/Application Support/Life Manager/workspace');
  // Do not silently replace an existing checkout-local workspace with a blank one.
  if (existsSync(resolve(legacy, 'life-manager.sqlite')) && (!existsSync(directory) || realpathSync(legacy) !== realpathSync(directory))) {
    throw new Error(`An existing workspace is at ${legacy}. Set LIFE_MANAGER_DATA_DIR to keep using it, or stop its server and move the whole directory to ${directory}.`);
  }
  return directory;
}
