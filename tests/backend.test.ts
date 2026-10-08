import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createLifeManagerActions, mutationInputSchema, promptTemplateSchema, workspaceSchema } from '../src/rpc.js';
import { createLifeManagerStore, initializeDatabase } from '../src/store.js';
import { localShare } from '../src/domain.js';
import { MAX_NOTES_CHARS } from '../src/types.js';
import type { Item, Workspace } from '../src/types.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  databases.splice(0).forEach(db => { if (db.open) db.close(); });
  directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }));
});

function setup(path = ':memory:') {
  const db = new Database(path);
  databases.push(db);
  initializeDatabase(db);
  const store = createLifeManagerStore(db);
  const signals: Record<string, unknown>[] = [];
  const actions = createLifeManagerActions(store, () => [], payload => signals.push(payload));
  return { db, store, actions, signals };
}

function itemById(value: Workspace, id: string): Item {
  const item = value.dashboard.items.find(candidate => candidate.id === id);
  if (!item) throw new Error(`Missing Item ${id}`);
  return item;
}

const template = { id: 'launch-game', name: 'Launch game', prompt: 'Launch {{item.name}}: {{item.url}} ({{item.id}})' };

describe('Life Manager backend', () => {
  it('validates Markdown bounds and rejects malformed application inputs before writes', () => {
    const { actions } = setup();
    const notes = '# Plan\n\n![Photo](/attachments/photo.png)\n\n| Next | Status |\n| --- | --- |\n| Research | Later |';
    expect(mutationInputSchema.safeParse({ command: { type: 'update', id: 'build', patch: { notes } } }).success).toBe(true);
    expect(mutationInputSchema.safeParse({ command: { type: 'update', id: 'build', patch: { notes: 'A'.repeat(MAX_NOTES_CHARS + 1) } } }).success).toBe(false);
    expect(() => actions.mutate({ command: { type: 'update', id: 'build', patch: { resourceUri: '\0bad' } } })).toThrow();
    expect(() => actions.mutate({ command: { type: 'update', id: 'build', patch: { defaultPromptId: 'missing' } } })).toThrow(/Unknown prompt/);
    expect(promptTemplateSchema.safeParse({ ...template, prompt: '  ' }).success).toBe(false);
    expect(actions.workspace().dashboard.revision).toBe(0);
  });

  it('seeds four Topics and persists Items, templates, and revisions across database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-manager-'));
    directories.push(directory);
    const path = join(directory, 'life-manager.sqlite');
    const first = setup(path);
    const initial = first.actions.workspace();
    expect(initial.dashboard.items.map(item => item.title)).toEqual(['Tend', 'Build', 'Learn', 'Enjoy']);
    expect(initial.promptTemplates).toEqual([]);
    first.actions.savePromptTemplate(template);
    const created = first.actions.mutate({ expectedRevision: 0, command: {
      type: 'create', id: 'project-one', parentId: 'build', title: 'Project one',
      patch: { defaultPromptId: template.id, resourceUri: 'file:///media/project', notes: '# Resume\n\nRead next.', status: 'Doing' },
    } });
    expect(itemById(created, 'project-one')).toMatchObject({ included: true, defaultPromptId: template.id });
    expect(first.signals).toHaveLength(2);
    first.db.close();
    const second = setup(path);
    const reloaded = second.actions.workspace();
    expect(itemById(reloaded, 'project-one')).toEqual(itemById(created, 'project-one'));
    expect(reloaded.dashboard.revision).toBe(1);
    expect(reloaded.promptTemplates).toEqual([template]);
    expect(workspaceSchema.safeParse(reloaded).success).toBe(true);
  });

  it('keeps historical notes and new fields isolated during snapshot corrections', () => {
    const { actions } = setup();
    actions.savePromptTemplate(template);
    const initial = actions.workspace();
    actions.mutate({ expectedRevision: 0, command: { type: 'update', id: 'tend', patch: {
      title: 'Tend at close', notes: '# At close', defaultPromptId: template.id, resourceUri: 'file:///original',
    } } });
    const rolled = actions.rollover({ name: 'Next period', expectedRevision: 1 });
    const closing = rolled.snapshots.find(snapshot => snapshot.periodId === initial.dashboard.periodId && snapshot.kind === 'closing')!;
    const nextOpening = rolled.snapshots.find(snapshot => snapshot.periodId === rolled.dashboard.periodId && snapshot.kind === 'opening')!;
    actions.mutate({ expectedRevision: rolled.dashboard.revision, command: { type: 'update', id: 'tend', patch: { title: 'Tend now', notes: '# Current' } } });
    const corrected = actions.mutate({ snapshotId: closing.id, expectedRevision: 0, command: {
      type: 'update', id: 'tend', patch: { title: 'Corrected closing', notes: '# Correction', resourceUri: 'file:///corrected', defaultPromptId: null },
    } });
    expect(itemById(corrected, 'tend')).toMatchObject({ notes: '# Correction', resourceUri: 'file:///corrected', defaultPromptId: null });
    expect(corrected.dashboard.revision).toBe(1);
    expect(itemById(actions.workspace(), 'tend')).toMatchObject({ title: 'Tend now', notes: '# Current', resourceUri: 'file:///original' });
    expect(itemById(actions.workspace({ snapshotId: nextOpening.id }), 'tend')).toMatchObject({ title: 'Tend at close', notes: '# At close', defaultPromptId: template.id });
  });

  it('bulk-deletes children atomically while preserving historical copies', () => {
    const { actions } = setup();
    actions.mutate({ command: { type: 'create', id: 'a', parentId: 'build', title: 'A' } });
    actions.mutate({ command: { type: 'create', id: 'b', parentId: 'build', title: 'B' } });
    actions.mutate({ command: { type: 'create', id: 'nested', parentId: 'a', title: 'Nested' } });
    const planned = actions.plan();
    const snapshotId = planned.snapshots.find(snapshot => snapshot.kind === 'planned')!.id;
    const historical = actions.workspace({ snapshotId });
    const current = actions.workspace();
    expect(() => actions.mutate({ command: { type: 'delete-many', ids: ['a', 'missing'] } })).toThrow();
    expect(actions.workspace()).toEqual(current);
    const removed = actions.mutate({ expectedRevision: current.dashboard.revision, command: { type: 'delete-many', ids: ['a', 'b'] } });
    expect(removed.dashboard.revision).toBe(current.dashboard.revision + 1);
    expect(removed.dashboard.items.some(item => ['a', 'b', 'nested'].includes(item.id))).toBe(false);
    expect(removed.dashboard.items.some(item => item.id === 'build')).toBe(true);
    expect(actions.workspace({ snapshotId })).toEqual(historical);
  });

  it('deletes current subtrees without changing historical snapshots', () => {
    const { actions } = setup();
    actions.mutate({ command: { type: 'create', id: 'parent', parentId: 'build', title: 'Project' } });
    actions.mutate({ command: { type: 'create', id: 'child', parentId: 'parent', title: 'Next step', patch: { included: false } } });
    const planned = actions.plan();
    const snapshotId = planned.snapshots.find(snapshot => snapshot.kind === 'planned')!.id;
    const historical = actions.workspace({ snapshotId });
    const deleted = actions.mutate({ command: { type: 'delete', id: 'parent' } });
    expect(deleted.dashboard.items.map(item => item.id)).not.toContain('parent');
    expect(deleted.dashboard.items.map(item => item.id)).not.toContain('child');
    expect(actions.workspace({ snapshotId })).toEqual(historical);
    actions.mutate({ snapshotId, command: { type: 'delete', id: 'child' } });
    expect(actions.workspace().dashboard).toEqual(deleted.dashboard);
    expect(actions.workspace({ snapshotId }).dashboard.items.map(item => item.id)).toContain('parent');
  });

  it('captures Planned once and rolls Closing and Opening over atomically', () => {
    const { actions } = setup();
    const initial = actions.workspace();
    const planned = actions.plan({ expectedRevision: 0 });
    expect(planned.snapshots.filter(snapshot => snapshot.kind === 'planned')).toHaveLength(1);
    expect(() => actions.plan({ expectedRevision: 1 })).toThrow(/already been finished/i);
    const rolled = actions.rollover({ expectedRevision: 1 });
    expect(rolled.periods).toHaveLength(2);
    expect(rolled.periods.find(period => period.id === initial.dashboard.periodId)?.closedAt).not.toBeNull();
    expect(rolled.snapshots.filter(snapshot => snapshot.kind === 'closing')).toHaveLength(1);
    const opening = rolled.snapshots.find(snapshot => snapshot.periodId === rolled.dashboard.periodId && snapshot.kind === 'opening')!;
    expect(actions.workspace({ snapshotId: opening.id }).dashboard.items).toEqual(rolled.dashboard.items);
  });

  it('rejects stale revisions for current and historical mutations', () => {
    const { actions } = setup();
    actions.mutate({ expectedRevision: 0, command: { type: 'update', id: 'tend', patch: { status: 'Now' } } });
    expect(() => actions.mutate({ expectedRevision: 0, command: { type: 'update', id: 'tend', patch: { status: 'Doing' } } })).toThrow(/revision conflict/i);
    const snapshotId = actions.workspace().snapshots[0]!.id;
    actions.mutate({ snapshotId, expectedRevision: 0, command: { type: 'update', id: 'tend', patch: { notes: '# Corrected' } } });
    expect(() => actions.mutate({ snapshotId, expectedRevision: 0, command: { type: 'delete', id: 'tend' } })).toThrow(/revision conflict/i);
  });

  it('keeps templates global and clears only current defaults when deleting one', () => {
    const { actions, db } = setup();
    actions.savePromptTemplate(template);
    actions.mutate({ command: { type: 'update', id: 'learn', patch: { defaultPromptId: template.id } } });
    const planned = actions.plan();
    const snapshotId = planned.snapshots.find(snapshot => snapshot.kind === 'planned')!.id;
    const snapshotBefore = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId);
    const updated = actions.savePromptTemplate({ ...template, name: 'Start game', prompt: 'Open {{item.id}}' });
    expect(actions.workspace({ snapshotId }).promptTemplates).toEqual([updated]);
    actions.deletePromptTemplate({ id: template.id });
    expect(actions.listPromptTemplates()).toEqual([]);
    expect(itemById(actions.workspace(), 'learn').defaultPromptId).toBeNull();
    expect(actions.workspace().dashboard.revision).toBe(planned.dashboard.revision + 1);
    expect(itemById(actions.workspace({ snapshotId }), 'learn').defaultPromptId).toBe(template.id);
    expect(db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId)).toEqual(snapshotBefore);
    const exported = actions.exportData();
    expect(exported.schemaVersion).toBe(2);
    expect(exported.promptTemplates).toEqual([]);
    expect(exported.snapshots.find(snapshot => snapshot.id === snapshotId)?.items.find(item => item.id === 'learn')?.defaultPromptId).toBe(template.id);
  });

  it('adds fields idempotently to an existing schema without rewriting historical notes', () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.exec(`CREATE TABLE items (
      id TEXT PRIMARY KEY, parent_id TEXT, sibling_order INTEGER NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL, notes TEXT NOT NULL, included INTEGER NOT NULL, weight REAL NOT NULL, effort_override REAL
    );`);
    initializeDatabase(db);
    const store = createLifeManagerStore(db);
    const snapshotId = store.workspace().snapshots[0]!.id;
    db.exec('ALTER TABLE items DROP COLUMN allocation_auto');
    initializeDatabase(db);
    const oldItems = store.workspace({ snapshotId }).dashboard.items.map(({ defaultPromptId, resourceUri, allocationAuto, ...item }) => ({ ...item, notes: '<p>Original historical HTML</p>' }));
    db.prepare('UPDATE snapshots SET items_json = ? WHERE id = ?').run(JSON.stringify(oldItems), snapshotId);
    const before = db.prepare('SELECT * FROM snapshots').all();
    initializeDatabase(db);
    initializeDatabase(db);
    expect(db.prepare('SELECT * FROM snapshots').all()).toEqual(before);
    expect(store.workspace({ snapshotId }).dashboard.items).toEqual(oldItems);
    expect(store.workspace().dashboard.items.every(item => item.defaultPromptId === null && item.resourceUri === null)).toBe(true);
    expect(store.listPromptTemplates()).toEqual([]);
    expect(store.workspace().dashboard.items.every(item => !item.allocationAuto)).toBe(true);
    expect(db.prepare('SELECT allocation_auto FROM items').all()).toEqual(Array(4).fill({ allocation_auto: 0 }));
  });
});


it('persists automatic allocation across reopen and checkpoints without rewriting history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'life-manager-auto-'));
  directories.push(directory);
  const path = join(directory, 'life-manager.sqlite');
  const first = setup(path);
  const oldSnapshot = first.actions.workspace().snapshots[0]!;
  const oldJson = first.db.prepare('SELECT items_json FROM snapshots WHERE id = ?').get(oldSnapshot.id);
  first.actions.mutate({ command: { type: 'allocate', id: 'enjoy', share: 25 } });
  first.actions.mutate({ command: { type: 'allocate', id: 'build', share: null } });
  first.actions.mutate({ command: { type: 'allocate', id: 'learn', share: null } });
  first.actions.mutate({ command: { type: 'allocate', id: 'tend', share: 40 } });
  expect(localShare(first.actions.workspace().dashboard.items, 'learn')).toBe(17.5);
  const rolled = first.actions.rollover({ name: 'With automatic allocations' });
  const closing = rolled.snapshots.find(snapshot => snapshot.kind === 'closing')!;
  first.db.close();
  const second = setup(path);
  expect(itemById(second.actions.workspace(), 'learn').allocationAuto).toBe(true);
  expect(workspaceSchema.safeParse(second.actions.workspace()).success).toBe(true);
  second.actions.mutate({ command: { type: 'allocate', id: 'tend', share: 50 } });
  expect(localShare(second.actions.workspace().dashboard.items, 'learn')).toBe(12.5);
  expect(localShare(second.actions.workspace({ snapshotId: closing.id }).dashboard.items, 'learn')).toBe(17.5);
  expect(second.db.prepare('SELECT items_json FROM snapshots WHERE id = ?').get(oldSnapshot.id)).toEqual(oldJson);
  second.actions.mutate({ snapshotId: closing.id, command: { type: 'allocate', id: 'enjoy', share: null } });
  expect(localShare(second.actions.workspace({ snapshotId: closing.id }).dashboard.items, 'learn')).toBe(20);
  expect(localShare(second.actions.workspace().dashboard.items, 'learn')).toBe(12.5);
});

it('applies and undoes outline moves as single revisions without changing snapshots', () => {
  const { actions } = setup();
  actions.mutate({ command: { type: 'create', id: 'project', parentId: 'build', title: 'Project', patch: { weight: 80 } } });
  actions.mutate({ command: { type: 'create', id: 'auto', parentId: 'learn', title: 'Automatic' } });
  actions.mutate({ command: { type: 'create', id: 'explicit', parentId: 'learn', title: 'Explicit', patch: { weight: 70 } } });
  const before = actions.workspace();
  const historical = actions.workspace({ snapshotId: before.snapshots[0]!.id });
  const after = actions.mutate({ expectedRevision: before.dashboard.revision, command: { type: 'arrange', ids: ['project'], parentId: 'learn', beforeId: 'explicit' } });
  expect(after.dashboard.revision).toBe(before.dashboard.revision + 1);
  const placement = ({ id, parentId, order, weight, allocationAuto }: Item) => ({ id, parentId, order, weight, allocationAuto });
  const undo = { type: 'restore-arrangement' as const, placements: before.dashboard.items.map(placement), expected: after.dashboard.items.map(item => ({ ...placement(item), included: item.included })) };
  const restored = actions.mutate({ expectedRevision: after.dashboard.revision, command: undo });
  expect(restored.dashboard.items).toEqual(before.dashboard.items);
  expect(restored.dashboard.revision).toBe(after.dashboard.revision + 1);
  expect(actions.workspace({ snapshotId: before.snapshots[0]!.id })).toEqual(historical);
  expect(() => actions.mutate({ command: { type: 'arrange', ids: ['project', 'missing'], parentId: 'learn' } })).toThrow();
  expect(actions.workspace().dashboard).toEqual(restored.dashboard);
});
