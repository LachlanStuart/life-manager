import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { LifeManagerActions, WidgetRegistrySurface } from './rpc.js';
import { widgetActionInputSchema, widgetRenderInputSchema } from './rpc.js';
import type { AgentReply, Item, PromptHandling, PromptTemplate } from './types.js';

export type { AgentReply } from './types.js';
export type AgentSender = (input: { item: Item; template: PromptTemplate; origin: string; target?: PromptHandling; context?: 'client' }) => Promise<AgentReply>;

export function createChangeFeed() {
  const clients = new Set<ServerResponse>();
  return {
    connect(_request: IncomingMessage, response: ServerResponse) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write('event: ready\ndata: {}\n\n');
      clients.add(response);
      const timer = setInterval(() => response.write(': alive\n\n'), 25_000);
      timer.unref();
      response.on('close', () => { clearInterval(timer); clients.delete(response); });
    },
    publish(payload: Record<string, unknown>) {
      for (const client of clients) client.write(`event: changed\ndata: ${JSON.stringify(payload)}\n\n`);
    },
    close() { for (const client of clients) client.end(); clients.clear(); },
  };
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const MAX_BODY = 20 * 1024 * 1024;
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY) throw new HttpError(413, 'This request exceeds 20 MB.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function imageExtension(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return '.gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return '.webp';
  throw new HttpError(415, 'Use a PNG, JPEG, GIF or WebP image.');
}

export function createHttpHandler(options: {
  actions: LifeManagerActions;
  widgets: WidgetRegistrySurface;
  attachmentsDir: string;
  publicDir: string;
  feed?: ReturnType<typeof createChangeFeed>;
  sendToAgent?: AgentSender;
  launchT3?: () => Promise<void>;
  serverIdentity?: import('./server-discovery.js').ServerIdentity;
}) {
  const { actions, widgets } = options;
  return async (request: IncomingMessage, response: ServerResponse) => {
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
      const protocol = localProxy && request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const origin = `${protocol}://${request.headers.host ?? 'localhost'}`;
      const url = new URL(request.url ?? '/', origin);
      if (request.method === 'POST') {
        if (request.headers.origin && new URL(request.headers.origin).host !== url.host) throw new HttpError(403, 'Cross-origin actions are not allowed.');
        if (request.headers['x-life-manager'] !== '1') throw new HttpError(403, 'Set the X-Life-Manager: 1 request header.');
        if (url.pathname === '/api/attachments') {
          const bytes = await readBody(request);
          const filename = `${randomUUID()}${imageExtension(bytes)}`;
          await mkdir(options.attachmentsDir, { recursive: true });
          await writeFile(resolve(options.attachmentsDir, filename), bytes, { flag: 'wx' });
          json({ url: `/attachments/${filename}` }, 201); return;
        }
        if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send application/json.');
        let body: unknown;
        try { body = JSON.parse((await readBody(request)).toString('utf8')); }
        catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON.'); }
        switch (url.pathname) {
          case '/api/mutate': json(actions.mutate(body as Parameters<LifeManagerActions['mutate']>[0])); return;
          case '/api/settings': json(actions.saveSettings(body as Parameters<LifeManagerActions['saveSettings']>[0])); return;
          case '/api/plan': json(actions.plan(body as Parameters<LifeManagerActions['plan']>[0])); return;
          case '/api/rollover': json(actions.rollover(body as Parameters<LifeManagerActions['rollover']>[0])); return;
          case '/api/widgets/render': json(await widgets.render(widgetRenderInputSchema.parse(body))); return;
          case '/api/widgets/action': json(await widgets.action(widgetActionInputSchema.parse(body))); return;
          case '/api/templates/save': json(actions.savePromptTemplate(body as PromptTemplate)); return;
          case '/api/templates/delete': actions.deletePromptTemplate(body as { id: string }); json({ deleted: true }); return;
          case '/api/agent/link': {
            const input = z.object({ itemId: z.string().min(1), templateId: z.string().min(1), target: z.enum(['modal', 'codex', 't3']).default('modal'), context: z.literal('client').optional() }).strict().parse(body);
            const item = actions.workspace().dashboard.items.find(value => value.id === input.itemId);
            const template = actions.listPromptTemplates().find(value => value.id === input.templateId);
            if (!item || !template) throw new HttpError(404, 'The Item or prompt template no longer exists.');
            if (!options.sendToAgent) throw new HttpError(503, 'Agent prompts are not configured.');
            json(await options.sendToAgent({ item, template, origin, target: input.target, ...(input.context ? { context: input.context } : {}) })); return;
          }
          case '/api/agent/t3': {
            z.object({}).strict().parse(body);
            if (!options.launchT3) throw new HttpError(503, 'T3 Code launch is not configured on this server.');
            await options.launchT3();
            json({ opened: true }); return;
          }
          default: throw new HttpError(404, 'No such action.');
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      if (url.pathname === '/api/server' && options.serverIdentity) { json(options.serverIdentity); return; }
      const view = url.searchParams.get('snapshotId') ? { snapshotId: url.searchParams.get('snapshotId')! } : {};
      if (url.pathname === '/api/workspace') { json(actions.workspace(view)); return; }
      if (url.pathname === '/api/templates') { json(actions.listPromptTemplates()); return; }
      if (url.pathname === '/api/export') { json(actions.exportData()); return; }
      if (url.pathname === '/api/health') { json({ ok: true }); return; }
      if (url.pathname === '/api/events' && options.feed) { options.feed.connect(request, response); return; }
      if (url.pathname.startsWith('/api/items/')) {
        const workspace = actions.workspace(view);
        const id = decodeURIComponent(url.pathname.slice('/api/items/'.length));
        const items = workspace.dashboard.items;
        const item = items.find(value => value.id === id);
        if (!item) throw new HttpError(404, 'Item not found.');
        const ancestors: Item[] = [];
        let parent = items.find(value => value.id === item.parentId);
        while (parent) { ancestors.unshift(parent); parent = items.find(value => value.id === parent!.parentId); }
        json({ item, children: items.filter(value => value.parentId === id).sort((a, b) => a.order - b.order), ancestors,
          revision: workspace.dashboard.revision, periodId: workspace.dashboard.periodId, snapshotId: workspace.dashboard.snapshotId }); return;
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'No such API endpoint.');
      const attachment = url.pathname.startsWith('/attachments/');
      const root = resolve(attachment ? options.attachmentsDir : options.publicDir);
      const relative = decodeURIComponent(attachment ? url.pathname.slice('/attachments/'.length) : url.pathname.slice(1));
      let path = resolve(root, relative || 'index.html');
      if (path !== root && !path.startsWith(root + sep)) throw new HttpError(404, 'File not found.');
      let info = await stat(path).catch(() => null);
      if (!info?.isFile() && !attachment && (url.pathname === '/' || /^\/items\/[^/]+$/.test(url.pathname))) {
        path = resolve(root, 'index.html'); info = await stat(path).catch(() => null);
      }
      if (!info?.isFile()) throw new HttpError(404, attachment ? 'Attachment not found.' : 'Page not found. Build the application with npm run build.');
      response.writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': attachment || path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof HttpError ? error.status : /Revision conflict/.test(message) ? 409 : 400;
      json({ error: message }, status);
    }
  };
}
