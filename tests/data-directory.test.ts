import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDataDirectory } from '../src/data-directory';

let temporary: string | undefined;
afterEach(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }); });

it('uses the macOS application-data directory, with explicit overrides and other platform defaults intact', () => {
  temporary = mkdtempSync(join(tmpdir(), 'life-manager-paths-'));
  const root = join(temporary, 'project');
  const home = join(temporary, 'home');
  expect(resolveDataDirectory(root, undefined, 'darwin', home)).toBe(join(home, 'Library/Application Support/Life Manager/workspace'));
  expect(resolveDataDirectory(root, '/tmp/chosen-workspace', 'darwin', home)).toBe('/tmp/chosen-workspace');
  expect(resolveDataDirectory(root, undefined, 'linux', home)).toBe(join(root, '.data'));
});

it('refuses to hide an existing legacy workspace and accepts its relocated symlink', () => {
  temporary = mkdtempSync(join(tmpdir(), 'life-manager-paths-'));
  const root = join(temporary, 'project');
  const home = join(temporary, 'home');
  const legacy = join(root, '.data');
  const destination = join(home, 'Library/Application Support/Life Manager/workspace');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'life-manager.sqlite'), 'test');
  expect(() => resolveDataDirectory(root, undefined, 'darwin', home)).toThrow('An existing workspace');
  expect(resolveDataDirectory(root, legacy, 'darwin', home)).toBe(legacy);
  mkdirSync(destination, { recursive: true });
  expect(() => resolveDataDirectory(root, undefined, 'darwin', home)).toThrow('An existing workspace');
  rmSync(legacy, { recursive: true });
  writeFileSync(join(destination, 'life-manager.sqlite'), 'test');
  symlinkSync(destination, legacy);
  expect(resolveDataDirectory(root, undefined, 'darwin', home)).toBe(destination);
});
