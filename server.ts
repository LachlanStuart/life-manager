import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './src/server-runtime.js';
import { resolveDataDirectory } from './src/data-directory.js';

const directory = dirname(fileURLToPath(import.meta.url));
try {
  const server = await startServer({
    dataDir: resolveDataDirectory(directory, process.env.LIFE_MANAGER_DATA_DIR),
    publicDir: resolve(directory, 'dist'), cwd: directory,
    host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 4317),
  });
  console.log(`Life Manager: ${server.origin}`);
  console.log(`Listening on ${server.host}:${server.port}; data: ${server.dataDir}`);
  const stop = () => { void server.stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
