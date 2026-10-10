import 'fake-indexeddb/auto';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { browserSqlite } from '../src/browser/sqlite';
import { createDemoApi } from '../src/browser/demo-api';
import * as storage from '../src/browser/storage';
import { createLifeManagerStore, initializeDatabase } from '../src/store';
import type { Workspace } from '../src/types';
import { parseRoute, routeUrl } from '../ui/navigation';

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = await initSqlJs(); });
const databases: IDBDatabase[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
async function setup() {
  const db = await storage.openDemoStorage(crypto.randomUUID()); databases.push(db);
  let queue = Promise.resolve<unknown>(undefined);
  const lock = <T,>(operation: () => Promise<T>) => {
    const result = queue.then(operation); queue = result.catch(() => undefined); return result;
  };
  const api = createDemoApi(SQL, db, lock);
  const workspace = () => api('workspace') as Promise<Workspace>;
  return { api, db, lock, workspace };
}

describe('browser-only demo', () => {
  it('persists deleted branches and restores them through the demo API', async () => {
    const { api, db, lock, workspace } = await setup();
    const before = await workspace();
    const deleted = await api('mutate', {command: {type: 'delete', id: 'garden'}}) as Workspace;
    const entry = deleted.recycleBin![0]!;
    expect(entry.itemCount).toBeGreaterThan(1);
    const reopened = createDemoApi(SQL, db, lock);
    expect((await reopened('workspace') as Workspace).recycleBin).toEqual(deleted.recycleBin);
    const restored = await reopened('recycle-bin/restore', {id: entry.id, expectedRevision: deleted.dashboard.revision}) as Workspace;
    expect(restored.recycleBin).toEqual([]);
    expect(restored.dashboard.items.find(item => item.id === 'garden')).toMatchObject({parentId: 'build', notes: before.dashboard.items.find(item => item.id === 'garden')!.notes});
    expect(restored.dashboard.items).toHaveLength(before.dashboard.items.length);
  });
  it('uses the shared seed, validates edits and restores them from IndexedDB', async () => {
    const { api, db, lock, workspace } = await setup();
    const initial = await workspace();
    expect(initial.dashboard.items).toHaveLength(30);
    expect(initial.dashboard.items.find(item => item.id === 'build')?.weight).toBe(35);
    await api('mutate', { expectedRevision: initial.dashboard.revision, command: { type: 'update', id: 'garden', patch: { notes: '# Remember this\n\nNext experiment.' } } });
    const reopened = createDemoApi(SQL, db, lock);
    const restored = await reopened('workspace') as Workspace;
    expect(restored.dashboard.items.find(item => item.id === 'garden')?.notes).toContain('Remember this');
    await expect(api('mutate', { command: { type: 'update', id: 'garden', patch: { status: 'Invented' } } })).rejects.toThrow();
    await expect(api('export')).rejects.toThrow(/does not provide.*export/);
    expect(await api('agent/link', {})).toMatchObject({ message: expect.stringContaining('unavailable') });
  });

  it('preserves planned/closing snapshots and isolates later corrections', async () => {
    const { api, workspace } = await setup();
    const before = await workspace();
    await api('plan', { expectedRevision: before.dashboard.revision });
    const next = await api('rollover', { name: 'Next week' }) as Workspace;
    expect(next.snapshots.map(snapshot => snapshot.kind)).toEqual(['opening', 'planned', 'closing', 'opening']);
    const closing = next.snapshots.find(snapshot => snapshot.kind === 'closing')!;
    await api('mutate', { command: { type: 'delete', id: 'garden' } });
    const historical = await api(`workspace?snapshotId=${closing.id}`) as Workspace;
    expect(historical.dashboard.items.some(item => item.id === 'garden')).toBe(true);
    await api('mutate', { snapshotId: closing.id, expectedRevision: historical.dashboard.revision,
      command: { type: 'update', id: 'garden', patch: { title: 'Corrected note' } } });
    expect((await workspace()).dashboard.items.some(item => item.id === 'garden')).toBe(false);
    const planned = next.snapshots.find(snapshot => snapshot.kind === 'planned')!;
    expect(((await api(`workspace?snapshotId=${planned.id}`)) as Workspace).dashboard.items.find(item => item.id === 'garden')?.title).toBe('Build a balcony herb garden');
  });

  it('serializes separate clients and rejects a stale write rather than losing an edit', async () => {
    const { api, db, lock, workspace } = await setup();
    const second = createDemoApi(SQL, db, lock);
    const { revision } = (await workspace()).dashboard;
    const command = { type: 'update', id: 'garden', patch: { title: 'New name' } };
    const results = await Promise.allSettled([api('mutate', { command, expectedRevision: revision }), second('mutate', { command, expectedRevision: revision })]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await workspace()).dashboard.items.find(item => item.id === 'garden')?.title).toBe('New name');
  });

  it('does not acknowledge or retain an edit when IndexedDB cannot save it', async () => {
    const { api, workspace } = await setup();
    const before = await workspace();
    vi.spyOn(storage, 'writeDemo').mockRejectedValueOnce(new Error('Storage full'));
    await expect(api('mutate', { command: { type: 'update', id: 'garden', patch: { title: 'Unsaved' } } })).rejects.toThrow('Storage full');
    expect(await workspace()).toEqual(before);
  });

  it('runs browser-safe widgets and rejects host-only or historical actions', async () => {
    const { api, workspace } = await setup();
    const initial = await workspace();
    const context = { itemId: 'garden', widgetId: 'branch-tools', config: {} };
    expect(await api('widgets/render', context)).toMatchObject({ html: expect.stringContaining('Branch tools') });
    await api('widgets/action', { ...context, action: 'create-child', input: { title: 'Try a new planter' } });
    expect((await workspace()).dashboard.items.some(item => item.title === 'Try a new planter')).toBe(true);
    await expect(api('widgets/action', { ...context, snapshotId: initial.snapshots[0]!.id, action: 'reset-branch' })).rejects.toThrow(/historical/);
    await expect(api('widgets/render', { ...context, widgetId: 'local-video' })).rejects.toThrow(/self-hosted/);
  });

  it('rolls back SQL failures and stays usable after exporting a database image', () => {
    const database = new SQL.Database();
    try {
      const db = browserSqlite(database); initializeDatabase(db);
      const store = createLifeManagerStore(db);
      expect(() => db.transaction(() => { db.prepare('DELETE FROM items').run(); throw new Error('fail'); })()).toThrow('fail');
      expect(store.workspace().dashboard.items).toHaveLength(4);
      database.export();
      store.mutate({ command: { type: 'update', id: 'tend', patch: { title: 'Home' } } });
      expect(store.workspace().dashboard.items.find(item => item.id === 'tend')?.title).toBe('Home');
    } finally { database.close(); }
  });

  it('keeps deep links on the static entry page and preserves their route on reload', () => {
    const route = { itemId: 'space & slash/', focusId: 'build', snapshotId: 'opening', view: 'kanban' as const };
    const target = routeUrl(route, true);
    expect(target).toContain('#/items/space%20%26%20slash%2F');
    expect(parseRoute(new URL(target, 'https://example.github.io'), true)).toEqual(route);
    expect(parseRoute(new URL('https://example.github.io/life-manager/'), true).itemId).toBeNull();
  });
});

it('persists enum settings and Unset assignments through browser reload without changing snapshots', async () => {
  const { api, db, lock, workspace } = await setup();
  const initial = await workspace();
  const settings = structuredClone(initial.settings!);
  settings.name = 'Browser workspace';
  settings.properties.push({ id: 'priority', name: 'Priority', unsetLabel: 'Unset', unsetColor: '#aabbcc', defaultValue: 'high', options: [{ id: 'high', label: 'High', color: '#ff0000' }] });
  await api('settings', { settings, expectedRevision: initial.dashboard.revision });
  await api('mutate', { command: { type: 'create', id: 'property-demo', parentId: 'build', title: 'Browser property' } });
  await api('mutate', { command: { type: 'update', id: 'property-demo', patch: { status: null, properties: { priority: null } } } });
  const restored = await createDemoApi(SQL, db, lock)('workspace') as Workspace;
  expect(restored.settings).toEqual(settings);
  expect(restored.dashboard.items.find(item => item.id === 'property-demo')).toMatchObject({ status: null, properties: { priority: null } });
  expect((await api(`workspace?snapshotId=${initial.snapshots[0]!.id}`) as Workspace).settings?.name).toBe('Life');
  await expect(api('settings', { settings, expectedRevision: 0 })).rejects.toThrow(/Revision conflict/);
});
