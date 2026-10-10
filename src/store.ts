/** The synchronous SQLite surface shared by native SQLite and the browser demo. */
export interface StoreDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<A extends unknown[], R>(operation: (...args: A) => R): (...args: A) => R;
}

import { mutateItems, restoreDeletedItems, seedItems } from './domain.js';
import { DEFAULT_WORKSPACE_SETTINGS, propertyValue, validateSettings } from './properties.js';
import type {
  Checkpoint,
  Item,
  MutationInput,
  Period,
  PromptTemplate,
  SnapshotSummary,
  ViewInput,
  WidgetSummary,
  Workspace,
  WorkspaceSettings,
  SaveSettingsInput,
  DeletedItemSummary,
  RestoreDeletedInput,
} from './types.js';

export const STORE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS life_manager_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS periods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    sibling_order INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT NOT NULL,
    included INTEGER NOT NULL,
    weight REAL NOT NULL,
    allocation_auto INTEGER NOT NULL DEFAULT 0,
    effort_override REAL,
    default_prompt_id TEXT,
    resource_uri TEXT
  );
  CREATE INDEX IF NOT EXISTS items_parent_order_idx
    ON items(parent_id, sibling_order);
  CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL,
    UNIQUE(period_id, kind)
  );
  CREATE INDEX IF NOT EXISTS snapshots_period_idx
    ON snapshots(period_id, captured_at);`,
  `CREATE TABLE IF NOT EXISTS deleted_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT,
    deleted_at TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    items_json TEXT NOT NULL
  );`,
] as const;

/** Apply only additive schema changes; existing snapshot JSON and notes remain untouched. */
export function initializeDatabase(db: StoreDatabase): void {
  db.transaction(() => {
    for (const migration of STORE_MIGRATIONS) db.exec(migration);
    const columns = new Set((db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>).map(column => column.name));
    if (!columns.has('default_prompt_id')) db.exec('ALTER TABLE items ADD COLUMN default_prompt_id TEXT');
    if (!columns.has('allocation_auto')) db.exec('ALTER TABLE items ADD COLUMN allocation_auto INTEGER NOT NULL DEFAULT 0');
    if (!columns.has('resource_uri')) db.exec('ALTER TABLE items ADD COLUMN resource_uri TEXT');
    if (!columns.has('properties_json')) db.exec("ALTER TABLE items ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}'");
    const snapshotColumns = new Set((db.prepare('PRAGMA table_info(snapshots)').all() as Array<{ name: string }>).map(column => column.name));
    if (!snapshotColumns.has('settings_json')) db.exec('ALTER TABLE snapshots ADD COLUMN settings_json TEXT');
    const defaults = JSON.stringify(DEFAULT_WORKSPACE_SETTINGS);
    db.prepare('UPDATE snapshots SET settings_json = ? WHERE settings_json IS NULL').run(defaults);
    db.prepare("INSERT OR IGNORE INTO life_manager_meta(key, value) VALUES ('workspace_settings', ?)").run(defaults);
  })();
}

interface ItemRow {
  id: string;
  parent_id: string | null;
  sibling_order: number;
  title: string;
  /** Empty SQL sentinel preserves compatibility with the legacy NOT NULL column. */
  status: string;
  properties_json: string;
  notes: string;
  included: number;
  weight: number;
  allocation_auto: number;
  effort_override: number | null;
  default_prompt_id: string | null;
  resource_uri: string | null;
}

interface PeriodRow {
  id: string;
  name: string;
  opened_at: string;
  closed_at: string | null;
}

interface SnapshotRow {
  id: string;
  period_id: string;
  kind: Checkpoint;
  captured_at: string;
  updated_at: string;
  revision: number;
  items_json: string;
  settings_json: string;
}

type SnapshotSummaryRow = Omit<SnapshotRow, 'items_json' | 'settings_json'>;
interface DeletedItemRow { id: string; title: string; parent_id: string | null; deleted_at: string; item_count: number; items_json: string }
const deletedSummary = (row: Omit<DeletedItemRow, 'items_json'>): DeletedItemSummary => ({
  id: row.id, title: row.title, parentId: row.parent_id, deletedAt: row.deleted_at, itemCount: row.item_count,
});

export interface StoreResult {
  workspace: Workspace;
  changed: boolean;
}

export interface ExportedLifeManagerData {
  schemaVersion: 2;
  promptTemplates: PromptTemplate[];
  exportedAt: string;
  current: {
    periodId: string;
    revision: number;
    items: Item[];
    settings: WorkspaceSettings;
  };
  periods: Period[];
  snapshots: Array<SnapshotSummary & { revision: number; items: Item[]; settings: WorkspaceSettings }>;
  recycleBin: Array<DeletedItemSummary & { items: Item[] }>;
}

export interface LifeManagerStore {
  workspace(input?: ViewInput, widgets?: WidgetSummary[]): Workspace;
  mutate(input: MutationInput, widgets?: WidgetSummary[]): StoreResult;
  restoreDeleted(input: RestoreDeletedInput, widgets?: WidgetSummary[]): StoreResult;
  saveSettings(input: SaveSettingsInput, widgets?: WidgetSummary[]): StoreResult;
  plan(expectedRevision?: number, widgets?: WidgetSummary[]): StoreResult;
  rollover(
    input?: { name?: string; expectedRevision?: number },
    widgets?: WidgetSummary[],
  ): StoreResult;
  exportData(): ExportedLifeManagerData;
  listPromptTemplates(): PromptTemplate[];
  savePromptTemplate(template: PromptTemplate): PromptTemplate;
  deletePromptTemplate(id: string): void;
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    parentId: row.parent_id,
    order: row.sibling_order,
    title: row.title,
    status: row.status || null,
    properties: JSON.parse(row.properties_json),
    notes: row.notes,
    included: row.included === 1,
    weight: row.weight,
    ...(row.allocation_auto === 1 ? { allocationAuto: true } : {}),
    effortOverride: row.effort_override,
    defaultPromptId: row.default_prompt_id,
    resourceUri: row.resource_uri,
  };
}

function toPeriod(row: PeriodRow): Period {
  return {
    id: row.id,
    name: row.name,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

function toSummary(row: SnapshotSummaryRow): SnapshotSummary {
  return {
    id: row.id,
    periodId: row.period_id,
    kind: row.kind,
    capturedAt: row.captured_at,
    updatedAt: row.updated_at,
  };
}

function sameItem(left: Item, right: Item): boolean {
  return left.id === right.id
    && left.parentId === right.parentId
    && left.order === right.order
    && left.title === right.title
    && left.status === right.status
    && JSON.stringify(left.properties ?? {}) === JSON.stringify(right.properties ?? {})
    && left.notes === right.notes
    && left.included === right.included
    && left.weight === right.weight
    && Boolean(left.allocationAuto) === Boolean(right.allocationAuto)
    && left.effortOverride === right.effortOverride
    && (left.defaultPromptId ?? null) === (right.defaultPromptId ?? null)
    && (left.resourceUri ?? null) === (right.resourceUri ?? null);
}

function parseItems(json: string): Item[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Stored snapshot Items are invalid.');
  return parsed as Item[];
}

export function createLifeManagerStore(
  db: StoreDatabase,
  options: { now?: () => Date; id?: () => string } = {},
): LifeManagerStore {
  const now = options.now ?? (() => new Date());
  const makeId = options.id ?? (() => globalThis.crypto.randomUUID());

  const getMetaStatement = db.prepare('SELECT value FROM life_manager_meta WHERE key = ?');
  const setMetaStatement = db.prepare(`
    INSERT INTO life_manager_meta(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const listItemsStatement = db.prepare(`
    SELECT id, parent_id, sibling_order, title, status, notes, included, weight,
           effort_override, default_prompt_id, resource_uri, allocation_auto, properties_json
    FROM items
    ORDER BY sibling_order, id
  `);
  const insertItemStatement = db.prepare(`
    INSERT INTO items(
      id, parent_id, sibling_order, title, status, notes, included, weight,
      effort_override, default_prompt_id, resource_uri, allocation_auto, properties_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateItemStatement = db.prepare(`
    UPDATE items
    SET parent_id = ?, sibling_order = ?, title = ?, status = ?, notes = ?,
        included = ?, weight = ?, effort_override = ?, default_prompt_id = ?, resource_uri = ?, allocation_auto = ?, properties_json = ?
    WHERE id = ?
  `);
  const deleteItemStatement = db.prepare('DELETE FROM items WHERE id = ?');
  const insertDeletedStatement = db.prepare('INSERT INTO deleted_items(id, title, parent_id, deleted_at, item_count, items_json) VALUES (?, ?, ?, ?, ?, ?)');
  const listDeletedStatement = db.prepare('SELECT id, title, parent_id, deleted_at, item_count FROM deleted_items ORDER BY deleted_at DESC, rowid DESC');
  const getDeletedStatement = db.prepare('SELECT * FROM deleted_items WHERE id = ?');
  const removeDeletedStatement = db.prepare('DELETE FROM deleted_items WHERE id = ?');
  const updatePropertiesStatement = db.prepare('UPDATE items SET status = ?, properties_json = ? WHERE id = ?');
  const listTemplatesStatement = db.prepare('SELECT id, name, prompt FROM prompt_templates ORDER BY name, id');
  const getTemplateStatement = db.prepare('SELECT id, name, prompt FROM prompt_templates WHERE id = ?');
  const saveTemplateStatement = db.prepare(`INSERT INTO prompt_templates(id, name, prompt) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, prompt = excluded.prompt`);
  const deleteTemplateStatement = db.prepare('DELETE FROM prompt_templates WHERE id = ?');
  const clearTemplateReferencesStatement = db.prepare('UPDATE items SET default_prompt_id = NULL WHERE default_prompt_id = ?');
  const listPeriodsStatement = db.prepare(`
    SELECT id, name, opened_at, closed_at
    FROM periods
    ORDER BY opened_at, rowid
  `);
  const getPeriodStatement = db.prepare(`
    SELECT id, name, opened_at, closed_at FROM periods WHERE id = ?
  `);
  const insertPeriodStatement = db.prepare(`
    INSERT INTO periods(id, name, opened_at, closed_at) VALUES (?, ?, ?, NULL)
  `);
  const closePeriodStatement = db.prepare(`
    UPDATE periods SET closed_at = ? WHERE id = ? AND closed_at IS NULL
  `);
  const listSnapshotSummariesStatement = db.prepare(`
    SELECT id, period_id, kind, captured_at, updated_at, revision
    FROM snapshots
    ORDER BY captured_at, rowid
  `);
  const listSnapshotsWithItemsStatement = db.prepare(`
    SELECT id, period_id, kind, captured_at, updated_at, revision, items_json, settings_json
    FROM snapshots
    ORDER BY captured_at, rowid
  `);
  const getSnapshotStatement = db.prepare(`
    SELECT id, period_id, kind, captured_at, updated_at, revision, items_json, settings_json
    FROM snapshots WHERE id = ?
  `);
  const getCheckpointStatement = db.prepare(`
    SELECT id, period_id, kind, captured_at, updated_at, revision, items_json, settings_json
    FROM snapshots WHERE period_id = ? AND kind = ?
  `);
  const insertSnapshotStatement = db.prepare(`
    INSERT INTO snapshots(
      id, period_id, kind, captured_at, updated_at, revision, items_json, settings_json
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const updateSnapshotStatement = db.prepare(`
    UPDATE snapshots
    SET items_json = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ?
  `);

  const getMeta = (key: string): string | undefined =>
    (getMetaStatement.get(key) as { value: string } | undefined)?.value;
  const setMeta = (key: string, value: string | number) => {
    setMetaStatement.run(key, String(value));
  };
  const currentPeriodId = () => {
    const id = getMeta('current_period_id');
    if (!id) throw new Error('Life Manager has no current period.');
    return id;
  };
  const currentSettings = (): WorkspaceSettings => JSON.parse(getMeta('workspace_settings') ?? JSON.stringify(DEFAULT_WORKSPACE_SETTINGS));
  const currentRevision = () => Number.parseInt(getMeta('current_revision') ?? '0', 10);
  const listItems = (): Item[] => (listItemsStatement.all() as ItemRow[]).map(toItem);
  const listPeriods = (): Period[] => (listPeriodsStatement.all() as PeriodRow[]).map(toPeriod);
  const listSnapshotSummaryRows = (): SnapshotSummaryRow[] =>
    listSnapshotSummariesStatement.all() as SnapshotSummaryRow[];
  const listSnapshotsWithItems = (): SnapshotRow[] =>
    listSnapshotsWithItemsStatement.all() as SnapshotRow[];
  const insertItem = (item: Item) => {
    insertItemStatement.run(
      item.id,
      item.parentId,
      item.order,
      item.title,
      item.status ?? '',
      item.notes,
      item.included ? 1 : 0,
      item.weight,
      item.effortOverride,
      item.defaultPromptId ?? null,
      item.resourceUri ?? null,
      item.allocationAuto ? 1 : 0,
      JSON.stringify(item.properties ?? {}),
    );
  };
  const captureSnapshot = (periodId: string, kind: Checkpoint, items: Item[], at: string) => {
    insertSnapshotStatement.run(
      `snapshot-${makeId()}`,
      periodId,
      kind,
      at,
      at,
      JSON.stringify(items),
      JSON.stringify(currentSettings()),
    );
  };

  const initialize = db.transaction(() => {
    if (getMeta('current_period_id')) return;
    const at = now().toISOString();
    const periodId = `period-${makeId()}`;
    const initialItems = seedItems();
    insertPeriodStatement.run(periodId, 'Period 1', at);
    for (const item of initialItems) insertItem(item);
    setMeta('current_period_id', periodId);
    setMeta('current_revision', 0);
    captureSnapshot(periodId, 'opening', initialItems, at);
  });
  initialize();

  function workspace(
    input: ViewInput = {},
    widgets: WidgetSummary[] = [],
  ): Workspace {
    const periods = listPeriods();
    const snapshots = listSnapshotSummaryRows().map(toSummary);
    if (input.snapshotId) {
      const snapshot = getSnapshotStatement.get(input.snapshotId) as SnapshotRow | undefined;
      if (!snapshot) throw new Error(`No snapshot with id ${input.snapshotId}.`);
      return {
        settings: JSON.parse(snapshot.settings_json),
        dashboard: {
          items: parseItems(snapshot.items_json),
          periodId: snapshot.period_id,
          snapshotId: snapshot.id,
          revision: snapshot.revision,
        },
        periods,
        snapshots,
        widgets,
        promptTemplates: listPromptTemplates(),
      };
    }
    return {
      settings: currentSettings(),
      dashboard: {
        items: listItems(),
        periodId: currentPeriodId(),
        snapshotId: null,
        revision: currentRevision(),
      },
      periods,
      snapshots,
      widgets,
      promptTemplates: listPromptTemplates(),
      recycleBin: (listDeletedStatement.all() as DeletedItemRow[]).map(deletedSummary),
    };
  }

  const mutateCurrent = db.transaction((input: MutationInput): boolean => {
    const revision = currentRevision();
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw new Error(
        `Revision conflict: expected ${input.expectedRevision}, current revision is ${revision}.`,
      );
    }
    const before = listItems();
    const after = mutateItems(before, input.command, currentSettings());
    for (const item of after) {
      if (item.defaultPromptId && !getTemplateStatement.get(item.defaultPromptId)) {
        throw new Error(`Unknown prompt template: ${item.defaultPromptId}`);
      }
    }
    const afterIds = new Set(after.map(item => item.id));
    const deleted = before.filter(item => !afterIds.has(item.id));
    const deletedIds = new Set(deleted.map(item => item.id));
    const roots = deleted.filter(item => item.parentId === null || !deletedIds.has(item.parentId));
    if (roots.length) {
      const children = new Map<string, Item[]>();
      for (const item of deleted) if (item.parentId !== null) {
        const siblings = children.get(item.parentId) ?? [];
        siblings.push(item); children.set(item.parentId, siblings);
      }
      const at = now().toISOString();
      for (const root of roots) {
        const branch = [root];
        for (let index = 0; index < branch.length; index++) branch.push(...(children.get(branch[index]!.id) ?? []));
        insertDeletedStatement.run(`deleted-${makeId()}`, root.title, root.parentId, at, branch.length, JSON.stringify(branch));
      }
    }
    const changed = persistItems(before, after);
    if (changed) setMeta('current_revision', revision + 1);
    return changed;
  });

  function persistItems(before: Item[], after: Item[]): boolean {
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const afterById = new Map(after.map((item) => [item.id, item]));
    let changed = false;

    for (const item of before) {
      if (!afterById.has(item.id)) {
        deleteItemStatement.run(item.id);
        changed = true;
      }
    }
    for (const item of after) {
      const previous = beforeById.get(item.id);
      if (!previous) {
        insertItem(item);
        changed = true;
      } else if (!sameItem(previous, item)) {
        updateItemStatement.run(
          item.parentId,
          item.order,
          item.title,
          item.status ?? '',
          item.notes,
          item.included ? 1 : 0,
          item.weight,
          item.effortOverride,
          item.defaultPromptId ?? null,
          item.resourceUri ?? null,
          item.allocationAuto ? 1 : 0,
          JSON.stringify(item.properties ?? {}),
          item.id,
        );
        changed = true;
      }
    }
    return changed;
  }

  const restoreBranch = db.transaction((input: RestoreDeletedInput) => {
    const revision = currentRevision();
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, current revision is ${revision}.`);
    }
    const entry = getDeletedStatement.get(input.id) as DeletedItemRow | undefined;
    if (!entry) throw new Error('This Item is no longer in the recycle bin.');
    const settings = currentSettings();
    const branch = parseItems(entry.items_json).map(item => {
      const properties: Record<string, string | null> = {};
      let status: string | null = null;
      for (const property of settings.properties) {
        const saved = propertyValue(item, property.id);
        const value = property.options.some(option => option.id === saved) ? saved : null;
        if (property.id === 'status') status = value;
        else if (Object.hasOwn(item.properties ?? {}, property.id)) properties[property.id] = value;
      }
      return { ...item, status, properties,
        defaultPromptId: item.defaultPromptId && getTemplateStatement.get(item.defaultPromptId) ? item.defaultPromptId : null };
    });
    const before = listItems();
    persistItems(before, restoreDeletedItems(before, branch, settings));
    removeDeletedStatement.run(input.id);
    setMeta('current_revision', revision + 1);
  });
  function restoreDeleted(input: RestoreDeletedInput, widgets: WidgetSummary[] = []): StoreResult {
    restoreBranch(input);
    return { workspace: workspace({}, widgets), changed: true };
  }

  const mutateSnapshot = db.transaction((input: MutationInput): boolean => {
    const snapshot = getSnapshotStatement.get(input.snapshotId) as SnapshotRow | undefined;
    if (!snapshot) throw new Error(`No snapshot with id ${input.snapshotId}.`);
    if (
      input.expectedRevision !== undefined
      && input.expectedRevision !== snapshot.revision
    ) {
      throw new Error(
        `Revision conflict: expected ${input.expectedRevision}, snapshot revision is ${snapshot.revision}.`,
      );
    }
    const before = parseItems(snapshot.items_json);
    const after = mutateItems(before, input.command, JSON.parse(snapshot.settings_json));
    const changed = before.length !== after.length
      || before.some((item, index) => !after[index] || !sameItem(item, after[index]));
    if (!changed) return false;
    const result = updateSnapshotStatement.run(
      JSON.stringify(after),
      now().toISOString(),
      snapshot.id,
      snapshot.revision,
    );
    if (result.changes !== 1) throw new Error('Snapshot changed while it was being corrected.');
    return true;
  });

  function mutate(input: MutationInput, widgets: WidgetSummary[] = []): StoreResult {
    const changed = input.snapshotId ? mutateSnapshot(input) : mutateCurrent(input);
    return { workspace: workspace(input, widgets), changed };
  }

  const updateSettings = db.transaction((input: SaveSettingsInput): boolean => {
    const revision = currentRevision();
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, current revision is ${revision}.`);
    }
    validateSettings(input.settings);
    const previous = currentSettings();
    const settings = input.settings;
    for (const [propertyId, replacements] of Object.entries(input.replacements ?? {})) {
      const oldProperty = previous.properties.find(property => property.id === propertyId);
      const property = settings.properties.find(property => property.id === propertyId);
      if (!oldProperty || !property) throw new Error(`Replacement property is invalid: ${propertyId}`);
      for (const [removedId, replacement] of Object.entries(replacements)) {
        if (!oldProperty.options.some(option => option.id === removedId) || property.options.some(option => option.id === removedId)) throw new Error(`Replacement source is not a removed option: ${removedId}`);
        if (replacement !== null && !property.options.some(option => option.id === replacement)) throw new Error(`Replacement value is invalid: ${replacement}`);
      }
    }
    if (JSON.stringify(settings) === JSON.stringify(previous)) return false;
    for (const item of listItems()) {
      const properties: Record<string, string | null> = {};
      let status: string | null = null;
      for (const property of settings.properties) {
        let value = propertyValue(item, property.id);
        if (value !== null && !property.options.some(option => option.id === value)) {
          value = input.replacements?.[property.id]?.[value] ?? null;
        }
        if (property.id === 'status') status = value;
        else if (Object.hasOwn(item.properties ?? {}, property.id)) properties[property.id] = value;
      }
      updatePropertiesStatement.run(status ?? '', JSON.stringify(properties), item.id);
    }
    setMeta('workspace_settings', JSON.stringify(settings));
    setMeta('current_revision', revision + 1);
    return true;
  });
  function saveSettings(input: SaveSettingsInput, widgets: WidgetSummary[] = []): StoreResult {
    const changed = updateSettings(input);
    return { workspace: workspace({}, widgets), changed };
  }

  const capturePlanned = db.transaction((expectedRevision?: number): boolean => {
    const revision = currentRevision();
    if (expectedRevision !== undefined && expectedRevision !== revision) {
      throw new Error(
        `Revision conflict: expected ${expectedRevision}, current revision is ${revision}.`,
      );
    }
    const periodId = currentPeriodId();
    if (getCheckpointStatement.get(periodId, 'planned')) {
      throw new Error('Planning has already been finished for this period.');
    }
    captureSnapshot(periodId, 'planned', listItems(), now().toISOString());
    setMeta('current_revision', revision + 1);
    return true;
  });

  function plan(expectedRevision?: number, widgets: WidgetSummary[] = []): StoreResult {
    capturePlanned(expectedRevision);
    return { workspace: workspace({}, widgets), changed: true };
  }

  const rollPeriod = db.transaction((input: { name?: string; expectedRevision?: number }) => {
    const revision = currentRevision();
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw new Error(
        `Revision conflict: expected ${input.expectedRevision}, current revision is ${revision}.`,
      );
    }
    const oldPeriodId = currentPeriodId();
    const oldPeriod = getPeriodStatement.get(oldPeriodId) as PeriodRow | undefined;
    if (!oldPeriod || oldPeriod.closed_at) throw new Error('The current period is already closed.');
    const items = listItems();
    const at = now().toISOString();
    captureSnapshot(oldPeriodId, 'closing', items, at);
    if (closePeriodStatement.run(at, oldPeriodId).changes !== 1) {
      throw new Error('The current period could not be closed.');
    }
    const periodCount = (listPeriodsStatement.all() as PeriodRow[]).length;
    const newPeriodId = `period-${makeId()}`;
    const name = input.name?.trim() || `Period ${periodCount + 1}`;
    insertPeriodStatement.run(newPeriodId, name, at);
    captureSnapshot(newPeriodId, 'opening', items, at);
    setMeta('current_period_id', newPeriodId);
    setMeta('current_revision', revision + 1);
  });

  function rollover(
    input: { name?: string; expectedRevision?: number } = {},
    widgets: WidgetSummary[] = [],
  ): StoreResult {
    rollPeriod(input);
    return { workspace: workspace({}, widgets), changed: true };
  }

  function exportData(): ExportedLifeManagerData {
    return {
      schemaVersion: 2,
      promptTemplates: listPromptTemplates(),
      exportedAt: now().toISOString(),
      current: {
        periodId: currentPeriodId(),
        revision: currentRevision(),
        items: listItems(),
        settings: currentSettings(),
      },
      periods: listPeriods(),
      snapshots: listSnapshotsWithItems().map((row) => ({
        ...toSummary(row),
        revision: row.revision,
        items: parseItems(row.items_json),
        settings: JSON.parse(row.settings_json),
      })),
      recycleBin: (db.prepare('SELECT * FROM deleted_items ORDER BY deleted_at DESC, rowid DESC').all() as DeletedItemRow[])
        .map(row => ({ ...deletedSummary(row), items: parseItems(row.items_json) })),
    };
  }

  function listPromptTemplates(): PromptTemplate[] {
    return listTemplatesStatement.all() as PromptTemplate[];
  }

  function savePromptTemplate(template: PromptTemplate): PromptTemplate {
    for (const key of ['id', 'name', 'prompt'] as const) {
      const value = template?.[key];
      const maximum = key === 'prompt' ? 100_000 : key === 'name' ? 500 : 200;
      if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) {
        throw new Error(`Prompt template ${key} is invalid.`);
      }
    }
    const saved = { id: template.id.trim(), name: template.name.trim(), prompt: template.prompt };
    saveTemplateStatement.run(saved.id, saved.name, saved.prompt);
    return saved;
  }

  const deletePromptTemplate = db.transaction((id: string): void => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Prompt template id is invalid.');
    if (!getTemplateStatement.get(id)) throw new Error(`Unknown prompt template: ${id}`);
    deleteTemplateStatement.run(id);
    if (clearTemplateReferencesStatement.run(id).changes > 0) {
      setMeta('current_revision', currentRevision() + 1);
    }
  });

  return { workspace, mutate, restoreDeleted, saveSettings, plan, rollover, exportData, listPromptTemplates, savePromptTemplate, deletePromptTemplate };
}
