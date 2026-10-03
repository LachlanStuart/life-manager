import { startServer, WorkspaceInUseError, type ServerOptions } from '../src/server-runtime.js';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server?.stop();
  process.exit(0);
}
process.parentPort.on('message', event => { if (event.data === 'stop') void stop(); });
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
// A crashed parent must not leave an invisible workspace owner behind.
const parent = process.ppid;
setInterval(() => {
  try { process.kill(parent, 0); } catch { void stop(); }
}, 2000).unref();
try {
  server = await startServer(JSON.parse(process.argv[2]) as ServerOptions);
  process.parentPort.postMessage({ type: 'ready', origin: server.origin, owned: true });
} catch (error) {
  if (error instanceof WorkspaceInUseError && error.origin) {
    process.parentPort.postMessage({ type: 'ready', origin: error.origin, owned: false });
    process.exit(0);
  }
  process.parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
