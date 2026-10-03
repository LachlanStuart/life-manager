import { createServer } from 'node:http';
import { mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import lockfile from 'proper-lockfile';
import { createLifeManagerStore, initializeDatabase } from './store.js';
import { createLifeManagerActions } from './rpc.js';
import { branchTools, createWidgetRegistry } from './widgets.js';
import { videoWidget } from './plugins/video.js';
import { createTwitchWidget } from './plugins/twitch.js';
import { createChangeFeed, createHttpHandler } from './http.js';
import { createCodexSender } from './agent.js';
import { discoverWorkspaceServer, serverRecordName, type ServerIdentity } from './server-discovery.js';

export interface ServerOptions {
  dataDir: string;
  publicDir: string;
  cwd: string;
  skillPath?: string;
  host?: string;
  port?: number;
}

export class WorkspaceInUseError extends Error {
  constructor(public readonly origin?: string) {
    super(origin ? `This workspace is already served at ${origin}.` : 'This workspace is in use or its server is starting. Try again shortly.');
  }
}

export async function startServer(options: ServerOptions) {
  await mkdir(options.dataDir, { recursive: true });
  const dataDir = await realpath(options.dataDir);
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(dataDir, { lockfilePath: resolve(dataDir, '.server.lock'), stale: 30_000 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new WorkspaceInUseError(await discoverWorkspaceServer(dataDir));
    throw error;
  }
  let db: Database.Database | undefined;
  const feed = createChangeFeed();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    db = new Database(resolve(dataDir, 'life-manager.sqlite'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initializeDatabase(db);
    const store = createLifeManagerStore(db);
    const actions = createLifeManagerActions(store, () => widgets.summaries(), feed.publish);
    const widgets = createWidgetRegistry(actions, [branchTools, videoWidget, createTwitchWidget({ dataDir: resolve(dataDir, 'plugins') })]);
    const identity: ServerIdentity = { application: 'life-manager', protocolVersion: 1, instanceId: randomUUID() };
    let origin: string;
    server = createServer(createHttpHandler({
      actions, widgets, feed, serverIdentity: identity,
      publicDir: options.publicDir, attachmentsDir: resolve(dataDir, 'attachments'),
      sendToAgent: input => createCodexSender({ cwd: options.cwd, skillPath: options.skillPath, apiOrigin: origin }).send(input),
    }));
    const host = options.host ?? '127.0.0.1';
    await new Promise<void>((done, reject) => {
      server!.once('error', reject);
      server!.listen(options.port ?? 0, host, () => { server!.removeListener('error', reject); done(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not acquire a TCP port.');
    const localHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? `[${host}]` : host;
    origin = `http://${localHost}:${address.port}`;
    await writeFile(resolve(dataDir, serverRecordName), JSON.stringify({ origin, instanceId: identity.instanceId }), { mode: 0o600 });
    let stopping: Promise<void> | undefined;
    return {
      origin, host, port: address.port, dataDir,
      stop(): Promise<void> {
        return stopping ??= (async () => {
          feed.close();
          await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done()));
          db!.close();
          await rm(resolve(dataDir, serverRecordName), { force: true });
          await release();
        })();
      },
    };
  } catch (error) {
    feed.close();
    if (server?.listening) await new Promise<void>(done => server!.close(() => done()));
    db?.close();
    await release();
    throw error;
  }
}
