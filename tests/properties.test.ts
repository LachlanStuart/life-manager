import Database from 'better-sqlite3';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { computeEfforts, mutateItems, seedItems } from '../src/domain';
import { DEFAULT_WORKSPACE_SETTINGS, propertyValue } from '../src/properties';
import { createLifeManagerActions, workspaceSchema } from '../src/rpc';
import { createLifeManagerStore, initializeDatabase, STORE_MIGRATIONS, type StoreDatabase } from '../src/store';
import { createWidgetRegistry } from '../src/widgets';
import { browserSqlite } from '../src/browser/sqlite';
import type { EnumProperty, Item, ItemPatch, WorkspaceSettings } from '../src/types';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const settings = (): WorkspaceSettings => structuredClone(DEFAULT_WORKSPACE_SETTINGS);
const priority = (): EnumProperty => ({ id: 'priority', name: 'Priority', unsetLabel: 'Unrated', unsetColor: '#aabbcc', defaultValue: 'high', options: [
  { id: 'high', label: 'High', color: '#ff0000' }, { id: 'low', label: 'Low', color: '#00ff00' },
] });
function setup() {
  const db = new Database(':memory:'); databases.push(db); initializeDatabase(db);
  const store = createLifeManagerStore(db);
  const actions = createLifeManagerActions(store);
  return { db, store, actions };
}
function item(items: Item[], id = 'build') { return items.find(value => value.id === id)!; }

describe('configurable enum properties', () => {
  it('resets effort, allocation and chosen properties atomically without changing snapshots', () => {
    const { actions } = setup();
    const config = settings(); config.properties.push(priority(), { ...priority(), id: 'energy' });
    actions.saveSettings({ settings: config });
    actions.mutate({ command: { type: 'create', id: 'hidden', parentId: 'build', title: 'Hidden child',
      patch: { included: false, status: 'Done', effortOverride: 140, weight: 7, notes: 'Keep notes' } } });
    actions.mutate({ command: { type: 'allocate', id: 'build', share: 70 } });
    const rolled = actions.rollover();
    const snapshotId = rolled.snapshots.find(snapshot => snapshot.periodId === rolled.dashboard.periodId && snapshot.kind === 'opening')!.id;
    const historical = actions.workspace({ snapshotId });
    const ids = rolled.dashboard.items.map(item => item.id);
    const patch = { allocationAuto: true, effortOverride: null, status: config.properties[0]!.defaultValue, properties: { priority: null } };
    expect(() => actions.mutate({ command: { type: 'bulk', ids: [...ids, 'missing'], patch } })).toThrow();
    expect(actions.workspace()).toEqual(rolled);
    const result = actions.mutate({ expectedRevision: rolled.dashboard.revision, command: { type: 'bulk', ids, patch } });
    expect(result.dashboard.revision).toBe(rolled.dashboard.revision + 1);
    expect(result.dashboard.items.every(item => item.allocationAuto && item.effortOverride === null && item.status === 'Later' && item.properties?.priority === null)).toBe(true);
    expect(item(result.dashboard.items, 'hidden')).toMatchObject({ included: false, parentId: 'build', notes: 'Keep notes', properties: { energy: 'high' } });
    expect(actions.workspace({ snapshotId })).toEqual(historical);
    expect(actions.workspace().dashboard.items).toEqual(result.dashboard.items);
  });

  it('keeps defaults distinct from Unset and merges partial patches, including bulk changes', () => {
    const { actions } = setup();
    const config = settings(); config.properties.push(priority(), { ...priority(), id: 'energy' });
    const before = actions.saveSettings({ settings: config });
    expect(propertyValue(item(before.dashboard.items), 'priority')).toBeNull();
    const created = actions.mutate({ command: { type: 'create', id: 'new', parentId: 'build', title: 'New' } });
    expect(item(created.dashboard.items, 'new').properties).toEqual({ priority: 'high', energy: 'high' });
    actions.mutate({ command: { type: 'update', id: 'new', patch: { properties: { priority: null } } } });
    const updated = actions.mutate({ command: { type: 'bulk', ids: ['new', 'build'], patch: { properties: { energy: 'low' } } } });
    expect(item(updated.dashboard.items, 'new').properties).toEqual({ priority: null, energy: 'low' });
    const unset = actions.mutate({ command: { type: 'create', id: 'unset', parentId: null, title: 'Unset', patch: { status: null, properties: { priority: null } } } });
    expect(item(unset.dashboard.items, 'unset')).toMatchObject({ status: null, properties: { priority: null, energy: 'high' } });
    expect(workspaceSchema.safeParse(unset).success).toBe(true);
  });

  it('validates assignments, configuration references and stale saves before making changes', () => {
    const { actions } = setup();
    const original = actions.workspace();
    for (const patch of [{ status: 'invented' }, { properties: { missing: null } }, { properties: { status: 'Later' } }] as ItemPatch[]) {
      expect(() => actions.mutate({ command: { type: 'update', id: 'build', patch } })).toThrow();
    }
    const config = settings(); config.name = 'New name';
    actions.saveSettings({ settings: config, expectedRevision: 0 });
    expect(() => actions.saveSettings({ settings: settings(), expectedRevision: 0 })).toThrow(/Revision conflict/);
    config.properties[0]!.defaultValue = 'missing';
    expect(() => actions.saveSettings({ settings: config })).toThrow(/Default value/);
    config.properties[0]!.defaultValue = null; config.lifecyclePropertyId = 'missing';
    expect(() => actions.saveSettings({ settings: config })).toThrow(/Lifecycle property/);
    expect(actions.workspace().dashboard.items).toEqual(original.dashboard.items);
    expect(actions.workspace().dashboard.revision).toBe(1);
  });

  it('freezes labels, colors, name and assignments in every checkpoint and validates corrections against that configuration', () => {
    const { actions } = setup();
    const config = settings(); config.name = 'Original'; config.properties.push(priority());
    actions.saveSettings({ settings: config });
    actions.mutate({ command: { type: 'update', id: 'build', patch: { properties: { priority: 'high' } } } });
    actions.plan(); const rolled = actions.rollover();
    const snapshots = rolled.snapshots.filter(snapshot => snapshot.kind !== 'opening' || snapshot.periodId === rolled.dashboard.periodId);
    config.name = 'Renamed'; config.properties[1]!.name = 'Importance';
    config.properties[1]!.options[0]!.label = 'Urgent'; config.properties[1]!.options[0]!.color = '#123456';
    actions.saveSettings({ settings: config });
    config.properties[1]!.options = config.properties[1]!.options.filter(option => option.id !== 'high');
    config.properties[1]!.defaultValue = null;
    const changed = actions.saveSettings({ settings: config, replacements: { priority: { high: 'low' } } });
    expect(propertyValue(item(changed.dashboard.items), 'priority')).toBe('low');
    for (const snapshot of snapshots) {
      const historical = actions.workspace({ snapshotId: snapshot.id });
      expect(historical.settings?.name).toBe('Original');
      expect(historical.settings?.properties[1]?.options[0]).toEqual(priority().options[0]);
      expect(propertyValue(item(historical.dashboard.items), 'priority')).toBe('high');
    }
    const snapshotId = snapshots[0]!.id;
    actions.mutate({ snapshotId, command: { type: 'update', id: 'build', patch: { properties: { priority: 'high' } } } });
    expect(() => actions.mutate({ command: { type: 'update', id: 'build', patch: { properties: { priority: 'high' } } } })).toThrow();
    const exported = actions.exportData();
    expect(exported.current.settings.name).toBe('Renamed');
    expect(exported.snapshots.find(snapshot => snapshot.id === snapshotId)?.settings.name).toBe('Original');
  });

  it('unsets removed values by default, rejects invalid replacements and permits deleting every property', () => {
    const { actions } = setup();
    const config = settings(); const status = config.properties[0]!;
    status.options = status.options.filter(option => option.id !== 'Later'); status.defaultValue = null;
    expect(() => actions.saveSettings({ settings: config, replacements: { status: { Later: 'invalid' } } })).toThrow(/Replacement value/);
    expect(item(actions.workspace().dashboard.items).status).toBe('Later');
    const changed = actions.saveSettings({ settings: config });
    expect(changed.dashboard.items.every(item => item.status === null)).toBe(true);
    const cleared = actions.saveSettings({ settings: { name: 'Empty', properties: [], lifecyclePropertyId: null } });
    expect(cleared.settings?.properties).toEqual([]);
    const created = actions.mutate({ command: { type: 'create', id: 'plain', parentId: null, title: 'Plain' } });
    expect(item(created.dashboard.items, 'plain').status).toBeNull();
    expect(computeEfforts(created.dashboard.items, created.settings).plain).toBe(0);
    expect(() => actions.mutate({ command: { type: 'update', id: 'plain', patch: { status: 'Later' } } })).toThrow(/Unknown property/);
  });

  it('uses only the designated lifecycle property while preserving manual overrides and parent aggregation', () => {
    const config = settings(); config.properties.push({ ...priority(), options: [
      { id: 'high', label: 'Finished', color: '#ff0000', behavior: 'complete' },
      { id: 'low', label: 'Skipped', color: '#00ff00', behavior: 'skip' },
    ] }); config.lifecyclePropertyId = 'priority';
    let items = mutateItems(seedItems(), { type: 'update', id: 'build', patch: { properties: { priority: 'high' } } }, config);
    items = mutateItems(items, { type: 'create', id: 'a', parentId: 'build', title: 'A' }, config);
    items = mutateItems(items, { type: 'create', id: 'b', parentId: 'build', title: 'B', patch: { status: 'Done', properties: { priority: null } } }, config);
    expect(computeEfforts(items, config).build).toBe(50);
    items = mutateItems(items, { type: 'update', id: 'build', patch: { properties: { priority: 'low' } } }, config);
    expect(computeEfforts(items, config).build).toBe(0);
    items = mutateItems(items, { type: 'update', id: 'build', patch: { effortOverride: 160 } }, config);
    expect(computeEfforts(items, config).build).toBe(160);
    config.lifecyclePropertyId = null;
    expect(computeEfforts(items, config).a).toBe(0);
    expect(computeEfforts(items, config).b).toBe(0);
  });
});

function verifyMigration(db: StoreDatabase) {
  for (const migration of STORE_MIGRATIONS) db.exec(migration);
  const legacy = JSON.stringify(seedItems());
  db.prepare('INSERT INTO snapshots(id,period_id,kind,captured_at,updated_at,items_json) VALUES (?,?,?,?,?,?)').run('old', 'past', 'closing', 'then', 'then', legacy);
  initializeDatabase(db); initializeDatabase(db);
  const row = db.prepare('SELECT items_json,settings_json FROM snapshots WHERE id = ?').get('old') as { items_json: string; settings_json: string };
  expect(row.items_json).toBe(legacy);
  expect(JSON.parse(row.settings_json)).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  const store = createLifeManagerStore(db);
  expect(store.workspace({ snapshotId: 'old' }).settings).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  const config = settings(); config.name = 'After migration';
  store.saveSettings({ settings: config });
  expect(store.workspace({ snapshotId: 'old' }).settings?.name).toBe('Life');
}
it('migrates native SQLite snapshots without rewriting historical Items', () => {
  const db = new Database(':memory:'); databases.push(db); verifyMigration(db);
});
it('applies the identical additive migration through sql.js', async () => {
  const SQL = await initSqlJs(); const database = new SQL.Database();
  try { verifyMigration(browserSqlite(database)); } finally { database.close(); }
});


it('resets only the designated lifecycle property and manual effort, including Unset defaults and no lifecycle', async () => {
  const { actions } = setup();
  const widgets = createWidgetRegistry(actions);
  const config = settings(); config.properties.push(priority()); config.lifecyclePropertyId = 'priority';
  actions.saveSettings({ settings: config });
  actions.mutate({ command: { type: 'update', id: 'build', patch: { status: 'Doing', effortOverride: 120, properties: { priority: 'low' } } } });
  const reset = () => widgets.action({ widgetId: 'branch-tools', itemId: 'build', action: 'reset-branch', input: {} });
  const reply = await reset();
  expect(reply.message).toContain('Priority to High');
  expect(item(actions.workspace().dashboard.items)).toMatchObject({ status: 'Doing', effortOverride: null, properties: { priority: 'high' } });
  config.properties[1]!.defaultValue = null;
  actions.saveSettings({ settings: config });
  expect((await reset()).message).toContain('Priority to Unrated');
  expect(item(actions.workspace().dashboard.items).properties?.priority).toBeNull();
  config.lifecyclePropertyId = null; actions.saveSettings({ settings: config });
  actions.mutate({ command: { type: 'update', id: 'build', patch: { effortOverride: 80, properties: { priority: 'low' } } } });
  expect((await reset()).message).toBe('Cleared manual effort for 1 Item.');
  expect(item(actions.workspace().dashboard.items)).toMatchObject({ status: 'Doing', effortOverride: null, properties: { priority: 'low' } });
});
