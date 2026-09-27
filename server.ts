import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createLifeManagerStore, initializeDatabase } from './src/store.js';
import { createLifeManagerActions } from './src/rpc.js';
import { branchTools, createWidgetRegistry } from './src/widgets.js';
import { videoWidget } from './src/plugins/video.js';
import { createTwitchWidget } from './src/plugins/twitch.js';
import { createChangeFeed, createHttpHandler } from './src/http.js';
import { createCodexSender } from './src/agent.js';

const directory = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.LIFE_MANAGER_DATA_DIR || resolve(directory, '.data'));
mkdirSync(dataDir, { recursive: true });
const db = new Database(resolve(dataDir, 'life-manager.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
initializeDatabase(db);
const store = createLifeManagerStore(db);
const feed = createChangeFeed();
const actions = createLifeManagerActions(store, () => widgets.summaries(), feed.publish);
const widgets = createWidgetRegistry(actions, [branchTools, videoWidget, createTwitchWidget({ dataDir: resolve(dataDir, 'plugins') })]);
const port = Number(process.env.PORT || 4317);
const codex = createCodexSender({ cwd: directory, apiOrigin: `http://127.0.0.1:${port}` });
const server = createServer(createHttpHandler({ actions, widgets, feed, publicDir: resolve(directory, 'dist'), attachmentsDir: resolve(dataDir, 'attachments'), sendToAgent: codex.send }));
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
  console.log(`Life Manager: http://localhost:${port}`);
  console.log(`Listening on ${host}:${port}; data: ${dataDir}`);
});
function stop() { feed.close(); server.close(() => { db.close(); process.exit(0); }); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
