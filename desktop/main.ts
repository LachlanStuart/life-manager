import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, shell, clipboard, utilityProcess, type UtilityProcess } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { parseConfig, externalLinkAllowed, type DesktopConfig } from './config.js';
import { validateServerConnection } from '../src/server-discovery.js';

app.setName('Life Manager');
if (process.env.LIFE_MANAGER_DESKTOP_HOME) app.setPath('userData', process.env.LIFE_MANAGER_DESKTOP_HOME);
const home = app.getPath('userData');
mkdirSync(home, { recursive: true });
const logPath = join(home, 'desktop.log');
const configPath = join(home, 'connection.json');
const defaultDirectory = join(home, 'workspace');
const resources = app.getAppPath();
const settingsUrl = pathToFileURL(join(resources, 'settings.html')).href;
let config: DesktopConfig | undefined;
let lastError = '';
let window: BrowserWindow | undefined;
let settings: BrowserWindow | undefined;
let tray: Tray;
let backend: UtilityProcess | undefined;
let origin: string | undefined;
let connecting = false;
let quitting = false;
let allowQuit = false;

function log(message: string) { appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`); }
function report(error: unknown) { lastError = error instanceof Error ? error.message : String(error); log(lastError); }

function trayImage() {
  const size = 36;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - 17.5, dy = y - 17.5, radius = Math.hypot(dx, dy);
    if (radius < 4 || (radius > 7 && radius < 10 && dx < 6) || (radius > 13 && radius < 16 && dy > -10)) pixels[(y * size + x) * 4 + 3] = 255;
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 });
  icon.setTemplateImage(true);
  return icon;
}

function openExternal(url: string) {
  if (externalLinkAllowed(url)) void shell.openExternal(url).catch(report);
}

function secureWindow(target: BrowserWindow, allowed: (url: string) => boolean) {
  target.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  target.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) { event.preventDefault(); openExternal(url); }
  });
  target.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  target.webContents.on('will-attach-webview', event => event.preventDefault());
  target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.webContents.session.setPermissionCheckHandler(() => false);
}

function showWorkspace() {
  if (!origin) { showSettings(); return; }
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  const activeOrigin = origin;
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 700, minHeight: 500, show: false, title: 'Life Manager',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const current = window;
  secureWindow(current, url => { try { return new URL(url).origin === activeOrigin; } catch { return false; } });
  current.on('close', event => { if (!allowQuit) { event.preventDefault(); current.hide(); } });
  current.on('closed', () => { if (window === current) window = undefined; });
  current.once('ready-to-show', () => { current.show(); current.focus(); });
  current.webContents.on('did-finish-load', () => log('Workspace window loaded.'));
  current.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) { report(`Could not load workspace: ${description}`); showSettings(); }
  });
  void current.loadURL(activeOrigin).catch(report);
}

function showSettings() {
  if (settings && !settings.isDestroyed()) { settings.show(); settings.focus(); return; }
  settings = new BrowserWindow({ width: 570, height: 730, resizable: false, show: false, title: 'Life Manager — Connection',
    webPreferences: { preload: join(resources, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  secureWindow(settings, url => url === settingsUrl);
  settings.on('closed', () => { settings = undefined; });
  settings.once('ready-to-show', () => { settings?.show(); settings?.focus(); });
  void settings.loadURL(settingsUrl).catch(report);
}

function updateMenu() {
  const addresses = origin && backend && config?.mode === 'local' && config.shareNetwork
    ? Object.values(networkInterfaces()).flatMap(values => values ?? []).filter(value => value.family === 'IPv4' && !value.internal)
      .map(value => `http://${value.address}:${new URL(origin!).port}`) : [];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Life Manager', click: showWorkspace },
    { label: origin ? (backend ? 'Local server running' : 'Connected to existing server') : 'No workspace connected', enabled: false },
    ...(origin ? [{ label: 'Open in Browser', click: () => openExternal(origin!) }, { label: origin, enabled: false }] : []),
    ...addresses.map(url => ({ label: `Copy ${url}`, click: () => clipboard.writeText(url) })),
    { type: 'separator' },
    { label: 'Connection Settings…', click: showSettings },
    { label: 'Open Log', click: () => { void shell.openPath(logPath); } },
    { type: 'separator' },
    { label: 'Quit Life Manager', accelerator: 'Command+Q', click: () => app.quit() },
  ]));
}

async function stopBackend() {
  const child = backend;
  backend = undefined;
  if (!child?.pid) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      if (child.pid) {
        log('Forcing shutdown of unresponsive local server.');
        try { process.kill(child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') report(error); }
      }
    }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.postMessage('stop');
  });
}

async function flushWorkspace() {
  if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      window.webContents.executeJavaScript('window.lifeManagerFlush?.()'),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Saving pending edits timed out.')), 10_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function startLocal(local: Extract<DesktopConfig, { mode: 'local' }>): Promise<string> {
  const child = utilityProcess.fork(join(resources, 'worker.mjs'), [JSON.stringify({
    dataDir: local.dataDir, cwd: local.dataDir, publicDir: join(resources, 'dist'),
    skillPath: join(resources, 'skills/life-manager/SKILL.md'),
    host: local.shareNetwork ? '0.0.0.0' : '127.0.0.1', port: local.port,
  })], { stdio: 'pipe', serviceName: 'Life Manager Server' });
  child.stdout?.on('data', data => log(String(data).trimEnd()));
  child.stderr?.on('data', data => log(String(data).trimEnd()));
  return new Promise<string>((resolve, reject) => {
    let ready = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('The local server did not start within 20 seconds. See Open Log in the menu bar.')); }, 20_000);
    child.on('message', message => {
      if (message?.type === 'ready') {
        ready = true;
        clearTimeout(timer);
        if (message.owned) backend = child;
        resolve(message.origin);
      } else if (message?.type === 'error') { clearTimeout(timer); reject(new Error(message.message)); }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (!ready) reject(new Error(`The local server exited (${code}). See Open Log in the menu bar.`));
      if (backend === child) {
        backend = undefined;
        origin = undefined;
        report('The local server stopped unexpectedly. Open Connection Settings to reconnect.');
        updateMenu();
        if (!quitting) showSettings();
      }
    });
  });
}

async function connect(next: DesktopConfig, save: boolean) {
  if (connecting || quitting) throw new Error('A connection is already starting or the app is quitting.');
  connecting = true;
  try {
    // Validate external servers before interrupting the currently open workspace.
    if (next.mode === 'remote') await validateServerConnection(next.url);
    await flushWorkspace();
    window?.destroy(); window = undefined;
    await stopBackend();
    origin = undefined;
    config = next;
    origin = next.mode === 'remote' ? next.url : await startLocal(next);
    if (save) {
      writeFileSync(`${configPath}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(`${configPath}.tmp`, configPath);
    }
    lastError = '';
    log(`Connected to ${origin}; ${backend ? 'owned local server' : 'external server'}`);
    showWorkspace();
    settings?.close();
  } finally { connecting = false; updateMenu(); }
}

function verifySettingsSender(event: Electron.IpcMainInvokeEvent) {
  if (!settings || event.sender !== settings.webContents || event.senderFrame !== settings.webContents.mainFrame || event.senderFrame.url !== settingsUrl) {
    throw new Error('This operation is only available in Connection Settings.');
  }
}
ipcMain.handle('desktop:load', event => { verifySettingsSender(event); return { config, defaultDirectory, error: lastError }; });
ipcMain.handle('desktop:directory', async event => {
  verifySettingsSender(event);
  const result = await dialog.showOpenDialog(settings!, { title: 'Choose workspace directory', properties: ['openDirectory', 'createDirectory'], defaultPath: config?.mode === 'local' ? config.dataDir : defaultDirectory });
  return result.canceled ? undefined : result.filePaths[0];
});
ipcMain.handle('desktop:connect', async (event, input: unknown) => {
  verifySettingsSender(event);
  try { await connect(parseConfig(input), true); return {}; }
  catch (error) { report(error); return { error: lastError }; }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  process.once('SIGTERM', () => app.quit());
  process.once('SIGINT', () => app.quit());
  app.on('second-instance', showWorkspace);
  app.on('activate', showWorkspace);
  app.on('window-all-closed', () => { /* The menu bar owns the app lifetime. */ });
  app.on('before-quit', event => {
    if (allowQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      try { await flushWorkspace(); }
      catch (error) {
        report(error);
        const answer = await dialog.showMessageBox({ type: 'warning', message: 'Some edits could not be saved.', detail: lastError,
          buttons: ['Keep Open', 'Quit Without Saving'], defaultId: 0, cancelId: 0 });
        if (answer.response === 0) { quitting = false; window?.show(); return; }
      }
      await stopBackend();
      allowQuit = true;
      // Avoid re-entering Electron's cancelled quit event when no backend was owned.
      setImmediate(() => app.quit());
    })().catch(error => { report(error); quitting = false; });
  });
  void app.whenReady().then(async () => {
    app.dock?.hide();
    tray = new Tray(trayImage());
    tray.setToolTip('Life Manager');
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Life Manager', submenu: [{ label: 'Connection Settings…', click: showSettings }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    updateMenu();
    try { config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report(error); }
    if (config) { try { await connect(config, false); } catch (error) { report(error); showSettings(); } }
    else showSettings();
  }).catch(error => { report(error); app.quit(); });
}
