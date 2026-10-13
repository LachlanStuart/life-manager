/** Private newline-JSON transport. stdin is the desktop's ownership pipe. */
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { startServer } from '../../src/server-runtime.js';
import { resolveDataDirectory } from '../../src/data-directory.js';
import { launchT3Conversation } from '../../src/t3-launch.js';
import { sendDesktopT3 } from '../agent-launch.js';

const root = resolve(import.meta.dirname, '../..');
const options = JSON.parse(process.argv[2]);
const output = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
let stopping = false;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let startup: Promise<void>;
async function stop() {
  if (stopping) return;
  stopping = true;
  await startup;
  await server?.stop();
  process.exit(process.exitCode ?? 0);
}
const input = createInterface({ input: process.stdin });
input.on('close', () => void stop());
input.on('line', line => {
  if (stopping) return;
  void (async () => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method === 'launchT3' && typeof message.id === 'string') {
      try {
        await startup;
        if (!server || stopping) throw new Error('The local server is unavailable.');
        await launchT3Conversation(server.dataDir, message.location);
        output({ id: message.id, result: { opened: true } });
      } catch (error) {
        output({ id: message.id, result: { opened: false, error: error instanceof Error ? error.message : 'Could not open T3 Code.' } });
      }
    }
    if (message.method === 'sendT3' && typeof message.id === 'string') {
      output({ id: message.id, result: await sendDesktopT3(message.prompt, message.webhookUrl) });
    }
  })();
});
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
startup = (async () => {
  try {
    const dataDir = resolveDataDirectory(root, options.dataDir);
    server = await startServer({ dataDir, cwd: dataDir, publicDir: options.publicDir ?? resolve(root, 'dist'),
      skillPath: resolve(root, 'skills/life-manager/SKILL.md'), host: '127.0.0.1', port: options.port ?? 0 });
    if (!stopping) output({ type: 'ready', origin: server.origin, dataDir: server.dataDir });
  } catch (error) {
    output({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
    input.close();
  }
})();
