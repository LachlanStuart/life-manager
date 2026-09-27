import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { initializeDatabase, createLifeManagerStore } from '../src/store.js';
import { seedDemo } from '../src/demo-seed.js';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(directory, '.demo-data');
const filename = resolve(dataDir, 'life-manager.sqlite');
if (!existsSync(filename)) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(filename); initializeDatabase(db);
  const store = createLifeManagerStore(db);
  seedDemo(db, store);
  db.close();
}
process.env.LIFE_MANAGER_DATA_DIR = dataDir;
await import('../server.js');
