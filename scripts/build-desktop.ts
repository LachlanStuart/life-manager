import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { packager } from '@electron/packager';
import { rebuild } from '@electron/rebuild';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build the desktop app on an Apple Silicon Mac.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, '.desktop-build');
const require = createRequire(join(root, 'package.json'));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const electronVersion = require('electron/package.json').version as string;
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await build({ entryPoints: [join(root, 'desktop/main.ts')], outfile: join(stage, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
await build({ entryPoints: [join(root, 'desktop/preload.ts')], outfile: join(stage, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
await build({ entryPoints: [join(root, 'desktop/workspace-preload.ts')], outfile: join(stage, 'workspace-preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
await build({ entryPoints: [join(root, 'desktop/worker.ts')], outfile: join(stage, 'worker.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['better-sqlite3'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
for (const file of ['settings.html', 'settings.css', 'settings.js']) await cp(join(root, 'desktop', file), join(stage, file));
await cp(join(root, 'desktop/tray-template.png'), join(stage, 'tray-template.png'));
await cp(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
await mkdir(join(stage, 'skills/life-manager'), { recursive: true });
await cp(join(root, 'skills/life-manager/SKILL.md'), join(stage, 'skills/life-manager/SKILL.md'));
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));

// Copy the locked, installed native dependency tree into staging. Never rebuild
// the repository's Node binary: the standalone server and tests still need it.
async function copyDependency(name: string, from: string, destinationParent: string) {
  const sourceManifest = createRequire(join(from, 'package.json')).resolve(`${name}/package.json`);
  const source = dirname(sourceManifest);
  const destination = join(destinationParent, 'node_modules', name);
  const pkg = JSON.parse(await readFile(sourceManifest, 'utf8'));
  await cp(source, destination, { recursive: true, dereference: true, filter: path => path !== join(source, 'node_modules') });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await copyDependency(dependency, source, destination);
}
await copyDependency('better-sqlite3', root, stage);
await writeFile(join(stage, 'package.json'), JSON.stringify({
  name: 'life-manager', productName: 'Life Manager', version: manifest.version, main: 'main.cjs', private: true,
  dependencies: { 'better-sqlite3': require('better-sqlite3/package.json').version },
}, null, 2));
console.log(`Packaging Electron ${electronVersion} for macOS arm64…`);
const paths = await packager({
  dir: stage, out: join(root, 'release'), name: 'Life Manager', executableName: 'Life Manager',
  appBundleId: 'com.lachlanstuart.life-manager', appCategoryType: 'public.app-category.productivity',
  platform: 'darwin', arch: 'arm64', electronVersion, overwrite: true, asar: false, prune: false, icon: join(root, 'desktop/life-manager.icns'),
  extendInfo: { LSUIElement: true },
  afterCopy: [async ({ buildPath, electronVersion, arch }) => {
    await rebuild({ buildPath, electronVersion, arch, onlyModules: ['better-sqlite3'], force: true });
  }],
});
console.log(`Desktop app: ${join(paths[0], 'Life Manager.app')}`);
