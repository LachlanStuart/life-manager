import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { createLifeManagerStore, initializeDatabase } from '../src/store';
import { createLifeManagerActions, workspaceSchema } from '../src/rpc';
import { localShare } from '../src/domain';

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function setup(path = ':memory:') {
  const db = new Database(path); databases.push(db); initializeDatabase(db);
  const signals: Record<string, unknown>[] = [];
  const store = createLifeManagerStore(db);
  const actions = createLifeManagerActions(store, () => [], signal => signals.push(signal));
  const create = (id: string, parentId: string | null = 'build') => actions.mutate({ command: { type: 'create', id, parentId, title: id } });
  return { db, store, actions, signals, create };
}

it('persists a deleted branch across reopen and restores all content without rewriting snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'life-manager-recycle-')); directories.push(directory);
  const path = join(directory, 'life.sqlite');
  const { db, actions, create } = setup(path);
  create('project'); create('child', 'project');
  actions.mutate({ command: { type: 'update', id: 'child', patch: { notes: '# Notes\n\n![Image](/attachments/sample.png)', included: false, effortOverride: 125, resourceUri: 'file:///synthetic/example.txt' } } });
  const before = actions.plan();
  const snapshotId = before.snapshots.find(snapshot => snapshot.kind === 'planned')!.id;
  const history = actions.workspace({ snapshotId });
  const removed = actions.mutate({ command: { type: 'delete', id: 'project' }, expectedRevision: before.dashboard.revision });
  expect(removed.recycleBin).toEqual([{ id: expect.any(String), title: 'project', parentId: 'build', deletedAt: expect.any(String), itemCount: 2 }]);
  expect(removed.dashboard.items.some(item => ['project', 'child'].includes(item.id))).toBe(false);
  expect(removed.dashboard.revision).toBe(before.dashboard.revision + 1);
  const entry = removed.recycleBin![0]!;
  expect(actions.exportData().recycleBin[0]!.items).toEqual(expect.arrayContaining(before.dashboard.items.filter(item => ['project', 'child'].includes(item.id))));
  db.close();
  const reopened = setup(path);
  expect(reopened.actions.workspace().recycleBin).toEqual(removed.recycleBin);
  const restored = reopened.actions.restoreDeleted({ id: entry.id, expectedRevision: removed.dashboard.revision });
  expect(workspaceSchema.parse(restored)).toEqual(restored);
  expect(restored.recycleBin).toEqual([]);
  expect(restored.dashboard.revision).toBe(removed.dashboard.revision + 1);
  for (const id of ['project', 'child']) expect(restored.dashboard.items.find(item => item.id === id)).toEqual(before.dashboard.items.find(item => item.id === id));
  expect(reopened.actions.workspace({ snapshotId })).toEqual(history);
  expect(reopened.signals.at(-1)).toMatchObject({ operation: 'restoreDeleted', revision: restored.dashboard.revision });
});

it('groups overlapping bulk deletions once and lists newest deletions first', () => {
  const { actions, create } = setup();
  create('a'); create('child', 'a'); create('b');
  const before = actions.workspace();
  expect(() => actions.mutate({command: {type: 'delete-many', ids: ['a', 'missing']}})).toThrow();
  expect(actions.workspace()).toEqual(before);
  const removed = actions.mutate({ command: { type: 'delete-many', ids: ['a', 'child', 'b'] } });
  expect(removed.recycleBin).toHaveLength(2);
  expect(removed.recycleBin!.find(entry => entry.title === 'a')!.itemCount).toBe(2);
  actions.mutate({ command: { type: 'delete', id: 'learn' } });
  expect(actions.workspace().recycleBin![0]!.title).toBe('Learn');
  const restored = actions.restoreDeleted({ id: removed.recycleBin!.find(entry => entry.title === 'a')!.id });
  expect(restored.dashboard.items.some(item => item.id === 'child')).toBe(true);
  expect(restored.recycleBin!.map(entry => entry.title).sort()).toEqual(['Learn', 'b']);
});

it('restores to the top level when the parent was deleted and keeps the bin through rollover', () => {
  const { actions, create } = setup();
  create('project'); create('child', 'project');
  const removed = actions.mutate({ command: { type: 'delete', id: 'project' } });
  actions.mutate({ command: { type: 'delete', id: 'build' } });
  actions.rollover();
  const restored = actions.restoreDeleted({ id: removed.recycleBin![0]!.id });
  expect(restored.dashboard.items.find(item => item.id === 'project')!.parentId).toBeNull();
  expect(restored.dashboard.items.find(item => item.id === 'child')!.parentId).toBe('project');
  expect(restored.recycleBin!.map(entry => entry.title)).toEqual(['Build']);
  const orders = restored.dashboard.items.filter(item => item.parentId === null).map(item => item.order);
  expect(new Set(orders).size).toBe(orders.length);
});

it('clears removed property choices and prompt references while preserving valid saved values', () => {
  const { actions, create } = setup();
  const settings = structuredClone(actions.workspace().settings!);
  settings.properties.push({id: 'priority', name: 'Priority', unsetLabel: 'Unset', unsetColor: '#888888', defaultValue: null,
    options: [{id: 'high', label: 'High', color: '#ff0000'}]});
  actions.saveSettings({settings});
  actions.savePromptTemplate({id: 'prompt', name: 'Prompt', prompt: 'Example'});
  create('project'); create('child', 'project');
  actions.mutate({command: {type: 'update', id: 'project', patch: {status: 'Doing', properties: {priority: 'high'}, defaultPromptId: 'prompt'}}});
  const removed = actions.mutate({command: {type: 'delete', id: 'project'}});
  settings.properties[0]!.options = settings.properties[0]!.options.filter(option => option.id !== 'Doing');
  settings.properties = settings.properties.filter(property => property.id !== 'priority');
  actions.saveSettings({settings}); actions.deletePromptTemplate({id: 'prompt'});
  const restored = actions.restoreDeleted({id: removed.recycleBin![0]!.id});
  expect(restored.dashboard.items.find(item => item.id === 'project')).toMatchObject({status: null, properties: {}, defaultPromptId: null});
  expect(restored.dashboard.items.find(item => item.id === 'child')!.status).toBe('Later');
});

it('rejects stale restores, duplicate IDs, repeated restores and historical restore inputs atomically', () => {
  const { actions, create } = setup();
  create('project'); create('child', 'project');
  const removed = actions.mutate({command: {type: 'delete', id: 'project'}});
  const id = removed.recycleBin![0]!.id;
  expect(() => actions.restoreDeleted({id, expectedRevision: removed.dashboard.revision - 1})).toThrow(/Revision conflict/);
  expect(() => actions.restoreDeleted({id, snapshotId: removed.snapshots[0]!.id} as any)).toThrow();
  expect(actions.workspace()).toEqual(removed);
  create('child');
  const collision = actions.workspace();
  expect(() => actions.restoreDeleted({id})).toThrow(/already exists/);
  expect(actions.workspace()).toEqual(collision);
  actions.mutate({command: {type: 'delete', id: 'child'}});
  actions.restoreDeleted({id});
  const restored = actions.workspace();
  expect(() => actions.restoreDeleted({id})).toThrow(/no longer/);
  expect(actions.workspace()).toEqual(restored);
});

it('normalizes current sibling allocations when restoring an automatic Item', () => {
  const { actions, create } = setup();
  create('a'); create('b'); create('auto');
  actions.mutate({command: {type: 'update', id: 'a', patch: {weight: 20, allocationAuto: false}}});
  actions.mutate({command: {type: 'update', id: 'b', patch: {weight: 60, allocationAuto: false}}});
  const removed = actions.mutate({command: {type: 'delete', id: 'auto'}});
  actions.mutate({command: {type: 'update', id: 'a', patch: {weight: 1}}});
  actions.mutate({command: {type: 'update', id: 'b', patch: {weight: 3}}});
  const restored = actions.restoreDeleted({id: removed.recycleBin![0]!.id});
  expect(localShare(restored.dashboard.items, 'a')).toBe(25);
  expect(localShare(restored.dashboard.items, 'b')).toBe(75);
  expect(localShare(restored.dashboard.items, 'auto')).toBe(0);
});

it('keeps historical deletion corrections separate from the current recycle bin', () => {
  const { actions } = setup();
  const before = actions.workspace();
  actions.mutate({snapshotId: before.snapshots[0]!.id, command: {type: 'delete', id: 'build'}});
  expect(actions.workspace().dashboard).toEqual(before.dashboard);
  expect(actions.workspace().recycleBin).toEqual([]);
});
