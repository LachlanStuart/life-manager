import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpHandler, type AgentSender } from '../src/http.js';
import { createLifeManagerActions, type WidgetRegistrySurface } from '../src/rpc.js';
import { createLifeManagerStore, initializeDatabase } from '../src/store.js';
import type { Item, PromptTemplate, Workspace } from '../src/types.js';
import { createWidgetRegistry } from '../src/widgets.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'life-manager-http-'));
  const attachmentsDir = join(directory, 'attachments');
  const publicDir = join(directory, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Life Manager test shell</title><main id="root"></main>');
  const db = new Database(':memory:');
  initializeDatabase(db);
  const store = createLifeManagerStore(db);
  let widgets: WidgetRegistrySurface;
  const actions = createLifeManagerActions(store, () => widgets.summaries());
  widgets = createWidgetRegistry(actions);
  const sendToAgent = vi.fn<AgentSender>(async () => ({ message: 'Codex link ready.', prompt: 'Full prompt', url: 'codex://threads/new?prompt=test' }));
  const launchT3 = vi.fn().mockResolvedValue(undefined);
  const server = createServer(createHttpHandler({ actions, widgets, attachmentsDir, publicDir, sendToAgent, launchT3 }));
  cleanups.push(async () => {
    server.closeAllConnections();
    if (server.listening) await closeServer(server);
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, init?: RequestInit) => fetch(origin + path, init);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => get(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Manager': '1', ...headers }, body: JSON.stringify(body),
  });
  return { actions, store, get, post, origin, attachmentsDir, sendToAgent, launchT3 };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/json');
  return await response.json() as T;
}

const prompt: PromptTemplate = { id: 'launch', name: 'Launch selected Item', prompt: 'Open {{item.name}} at {{item.url}} ({{item.id}})' };

it('lists deleted Items and restores through HTTP with revision and snapshot validation', async () => {
  const {get, post} = await setup();
  const deleted = await json<Workspace>(await post('/api/mutate', {command: {type: 'delete', id: 'build'}}));
  const entry = deleted.recycleBin![0]!;
  expect((await json<Workspace>(await get('/api/workspace'))).recycleBin).toEqual(deleted.recycleBin);
  await json(await post('/api/recycle-bin/restore', {id: entry.id, expectedRevision: deleted.dashboard.revision - 1}), 409);
  expect((await post('/api/recycle-bin/restore', {id: entry.id, snapshotId: deleted.snapshots[0]!.id})).ok).toBe(false);
  const restored = await json<Workspace>(await post('/api/recycle-bin/restore', {id: entry.id, expectedRevision: deleted.dashboard.revision}));
  expect(restored.recycleBin).toEqual([]);
  expect(restored.dashboard.items.some(item => item.id === 'build')).toBe(true);
});

it('only launches T3 on an explicit protected action, never while preparing a prompt', async () => {
  const { post, get, launchT3, sendToAgent } = await setup();
  await json(await post('/api/templates/save', prompt));
  await json(await post('/api/agent/link', { itemId: 'build', templateId: prompt.id, target: 't3', context: 'client' }));
  expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({ target: 't3', context: 'client' }));
  expect(launchT3).not.toHaveBeenCalled();
  await json(await post('/api/agent/t3', {}, { Origin: 'https://foreign.example' }), 403);
  await json(await get('/api/agent/t3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), 403);
  await json(await post('/api/agent/t3', { cwd: '/arbitrary/path' }), 400);
  expect(launchT3).not.toHaveBeenCalled();
  expect(await json(await post('/api/agent/t3', {}))).toEqual({ opened: true });
  expect(launchT3).toHaveBeenCalledExactlyOnceWith(undefined);
  await json(await post('/api/agent/t3', { location: '/Applications/T3 Code.app' }));
  expect(launchT3).toHaveBeenLastCalledWith('/Applications/T3 Code.app');
  await json(await post('/api/agent/t3', { location: { executable: '/tmp/script' } }), 400);
});

describe('standalone HTTP application', () => {
  it('reads the workspace and Item context and applies validated mutations over HTTP', async () => {
    const { get, post } = await setup();
    const initial = await json<Workspace>(await get('/api/workspace'));
    expect(initial.dashboard.items.map(item => item.title)).toEqual(['Tend', 'Build', 'Learn', 'Enjoy']);
    expect(initial.widgets.some(widget => widget.id === 'branch-tools')).toBe(true);
    const created = await json<Workspace>(await post('/api/mutate', { expectedRevision: 0, command: {
      type: 'create', id: 'nested project', parentId: 'build', title: 'A searchable project', patch: { included: false, notes: '# Resume\n\nNext action.' },
    } }));
    expect(created.dashboard.revision).toBe(1);
    const context = await json<{ item: Item; children: Item[]; ancestors: Item[]; revision: number }>(await get('/api/items/nested%20project'));
    expect(context.item).toMatchObject({ id: 'nested project', title: 'A searchable project', included: false, notes: '# Resume\n\nNext action.' });
    expect(context.ancestors.map(item => item.id)).toEqual(['build']);
    expect(context.children).toEqual([]);
    expect(context.revision).toBe(1);
    const parent = await json<{ children: Item[] }>(await get('/api/items/build'));
    expect(parent.children.map(item => item.id)).toEqual(['nested project']);
    expect((await get('/api/items/missing')).status).toBe(404);
  });

  it('returns conflict and input errors without applying rejected changes', async () => {
    const { get, post } = await setup();
    await json<Workspace>(await post('/api/mutate', { expectedRevision: 0, command: { type: 'update', id: 'build', patch: { status: 'Doing' } } }));
    const conflict = await json<{ error: string }>(await post('/api/mutate', { expectedRevision: 0, command: { type: 'delete', id: 'build' } }), 409);
    expect(conflict.error).toMatch(/Revision conflict/);
    await json(await post('/api/mutate', { command: { type: 'update', id: 'build', patch: { status: 'Invented status' } } }), 400);
    await json(await get('/api/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Manager': '1' }, body: '{malformed' }), 400);
    await json(await get('/api/mutate', { method: 'POST', headers: { 'X-Life-Manager': '1' }, body: '{}' }), 415);
    const context = await json<{ item: Item; revision: number }>(await get('/api/items/build'));
    expect(context.item.status).toBe('Doing');
    expect(context.revision).toBe(1);
  });

  it('rejects foreign-origin or missing-header writes before they reach application actions', async () => {
    const { get, post, actions } = await setup();
    const body = { command: { type: 'update', id: 'tend', patch: { status: 'Done' } } };
    await json(await post('/api/mutate', body, { Origin: 'https://unrelated.example' }), 403);
    await json(await get('/api/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 403);
    expect(actions.workspace().dashboard.revision).toBe(0);
    expect(actions.workspace().dashboard.items.find(item => item.id === 'tend')?.status).toBe('Later');
  });

  it('saves and serves managed image bytes and rejects SVG uploads', async () => {
    const { get, origin, attachmentsDir } = await setup();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=', 'base64');
    const uploaded = await json<{ url: string }>(await get('/api/attachments', { method: 'POST', headers: {
      'X-Life-Manager': '1', 'Content-Type': 'image/png', Origin: origin,
    }, body: bytes }), 201);
    expect(uploaded.url).toMatch(/^\/attachments\/[\da-f-]+\.png$/);
    expect(await readFile(join(attachmentsDir, uploaded.url.split('/').at(-1)!))).toEqual(bytes);
    const downloaded = await get(uploaded.url);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('image/png');
    expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    const head = await get(uploaded.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get('content-length'))).toBe(bytes.length);
    expect(await head.text()).toBe('');
    await json(await get('/api/attachments', { method: 'POST', headers: { 'X-Life-Manager': '1', 'Content-Type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }), 415);
    expect((await get('/attachments/missing.png')).status).toBe(404);
  });

  it('serves deep Item links through the app shell while missing assets remain 404', async () => {
    const { get } = await setup();
    for (const path of ['/', '/items/build', '/items/saved%20item?focus=learn']) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('Life Manager test shell');
    }
    expect((await get('/assets/missing.js')).status).toBe(404);
    expect((await get('/api/missing')).status).toBe(404);
    expect((await get('/attachments/%2e%2e%2fpublic%2findex.html')).status).toBe(404);
  });

  it('exposes prompt configuration, checkpoints, historical Item reads, and export', async () => {
    const { get, post } = await setup();
    expect(await json(await get('/api/templates'))).toEqual([]);
    expect(await json(await post('/api/templates/save', prompt))).toEqual(prompt);
    const saved = await json<Workspace>(await post('/api/mutate', { command: { type: 'update', id: 'learn', patch: { defaultPromptId: prompt.id } } }));
    const planned = await json<Workspace>(await post('/api/plan', { expectedRevision: saved.dashboard.revision }));
    const plannedSnapshot = planned.snapshots.find(snapshot => snapshot.kind === 'planned')!;
    const rolled = await json<Workspace>(await post('/api/rollover', { name: 'Next intention', expectedRevision: planned.dashboard.revision }));
    expect(rolled.periods).toHaveLength(2);
    expect(rolled.periods.at(-1)?.name).toBe('Next intention');
    const historical = await json<{ item: Item; snapshotId: string }>(await get(`/api/items/learn?snapshotId=${plannedSnapshot.id}`));
    expect(historical.snapshotId).toBe(plannedSnapshot.id);
    expect(historical.item.defaultPromptId).toBe(prompt.id);
    const exported = await json<{ schemaVersion: number; promptTemplates: PromptTemplate[]; snapshots: unknown[] }>(await get('/api/export'));
    expect(exported.schemaVersion).toBe(2);
    expect(exported.promptTemplates).toEqual([prompt]);
    expect(exported.snapshots).toHaveLength(4);
    expect(await json(await post('/api/templates/delete', { id: prompt.id }))).toEqual({ deleted: true });
    expect(await json(await get('/api/templates'))).toEqual([]);
  });

  it('routes widget rendering and validated actions through the selected Item', async () => {
    const { get, post } = await setup();
    const rendered = await json<{ html: string }>(await post('/api/widgets/render', { widgetId: 'branch-tools', itemId: 'build' }));
    expect(rendered.html).toContain('Branch tools for');
    expect(rendered.html).toContain('<strong>Build</strong>');
    const reply = await json<{ message: string }>(await post('/api/widgets/action', { widgetId: 'branch-tools', itemId: 'build', action: 'create-child', input: { title: 'Made by widget' } }));
    expect(reply.message).toContain('Made by widget');
    const parent = await json<{ children: Item[] }>(await get('/api/items/build'));
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toMatchObject({ title: 'Made by widget', status: 'Later', included: true });
    await json(await post('/api/widgets/action', { widgetId: 'branch-tools', itemId: 'build', action: 'create-child', input: { title: '' } }), 400);
    await json(await post('/api/widgets/action', { widgetId: 'branch-tools', itemId: 'build', action: 'nonexistent' }), 400);
  });

  it('preserves HTTPS Item links when dispatched through the local reverse proxy', async () => {
    const { get, post, origin, sendToAgent } = await setup();
    await json(await post('/api/templates/save', prompt));
    await json(await get('/api/agent/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Life-Manager': '1', 'X-Forwarded-Proto': 'https', Origin: origin.replace('http:', 'https:') },
      body: JSON.stringify({ itemId: 'learn', templateId: prompt.id }),
    }));
    expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({ origin: origin.replace('http:', 'https:') }));
  });

  it('dispatches exactly the selected Item and template without changing its lifecycle or effort', async () => {
    const { get, post, origin, sendToAgent } = await setup();
    await json(await post('/api/templates/save', prompt));
    await json(await post('/api/mutate', { command: { type: 'update', id: 'learn', patch: { defaultPromptId: prompt.id } } }));
    const before = await json<Workspace>(await post('/api/mutate', { command: { type: 'create', id: 'game', parentId: 'learn', title: 'Selected game', patch: { status: 'Doing', effortOverride: 135 } } }));
    const item = before.dashboard.items.find(value => value.id === 'game')!;
    expect(await json(await post('/api/agent/link', { itemId: item.id, templateId: prompt.id }))).toEqual({ message: 'Codex link ready.', prompt: 'Full prompt', url: 'codex://threads/new?prompt=test' });
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith({ item, template: prompt, origin, target: 'modal' });
    await json(await post('/api/agent/link', { itemId: item.id, templateId: prompt.id, target: 'codex' }));
    expect(sendToAgent).toHaveBeenLastCalledWith({ item, template: prompt, origin, target: 'codex' });
    await json(await post('/api/agent/link', { itemId: item.id, templateId: prompt.id, target: 'unknown' }), 400);
    expect(sendToAgent).toHaveBeenCalledTimes(2);
    const after = await json<Workspace>(await get('/api/workspace'));
    expect(after.dashboard).toEqual(before.dashboard);
    await json(await post('/api/agent/link', { itemId: 'unknown', templateId: prompt.id }), 404);
    expect(sendToAgent).toHaveBeenCalledTimes(2);
  });
});

it('saves enum configuration and Unset values through HTTP with revision and reference checks', async () => {
  const { get, post } = await setup();
  const initial = await json<Workspace>(await get('/api/workspace'));
  const settings = structuredClone(initial.settings!);
  settings.name = 'HTTP workspace';
  settings.properties.push({ id: 'priority', name: 'Priority', unsetLabel: 'Unset', unsetColor: '#aabbcc', defaultValue: 'high', options: [{ id: 'high', label: 'High', color: '#ff0000' }] });
  const configured = await json<Workspace>(await post('/api/settings', { settings, expectedRevision: 0 }));
  expect(configured.settings).toEqual(settings);
  expect(configured.dashboard.revision).toBe(1);
  const updated = await json<Workspace>(await post('/api/mutate', { command: { type: 'update', id: 'build', patch: { status: null, properties: { priority: 'high' } } } }));
  expect(updated.dashboard.items.find(item => item.id === 'build')).toMatchObject({ status: null, properties: { priority: 'high' } });
  expect((await post('/api/settings', { settings, expectedRevision: 0 })).status).toBe(409);
  expect((await post('/api/mutate', { command: { type: 'update', id: 'build', patch: { properties: { priority: 'unknown' } } } })).status).toBe(400);
  expect((await post('/api/settings', { settings, snapshotId: initial.snapshots[0]!.id })).status).toBe(400);
});
