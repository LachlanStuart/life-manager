import { z } from 'zod';

import type { LifeManagerStore } from './store.js';
import { MAX_NOTES_CHARS } from './types.js';
import type {
  MutationInput,
  RestoreDeletedInput,
  SaveSettingsInput,
  PromptTemplate,
  ViewInput,
  WidgetActionInput,
  WidgetActionResult,
  WidgetRenderInput,
  WidgetRenderResult,
  WidgetSummary,
  Workspace,
} from './types.js';

const idSchema = z.string().trim().min(1).max(200);
const resourceUriSchema = z.string().trim().min(1).max(8192).refine(value => !value.includes('\0'));
const nullableParentSchema = idSchema.nullable();
const statusSchema = idSchema.nullable();
const finiteNonNegativeSchema = z.number().finite().nonnegative();

export const itemPatchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  status: statusSchema.optional(),
  properties: z.record(idSchema, idSchema.nullable()).optional(),
  notes: z.string().max(MAX_NOTES_CHARS).optional(),
  included: z.boolean().optional(),
  weight: finiteNonNegativeSchema.optional(),
  allocationAuto: z.boolean().optional(),
  effortOverride: finiteNonNegativeSchema.nullable().optional(),
  defaultPromptId: idSchema.nullable().optional(),
  resourceUri: resourceUriSchema.nullable().optional(),
}).strict();

const placementShape = { id: idSchema, parentId: nullableParentSchema, order: z.number().int(), weight: finiteNonNegativeSchema, allocationAuto: z.boolean().optional() };
export const itemCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    id: idSchema.optional(),
    parentId: nullableParentSchema,
    title: z.string().trim().min(1).max(500),
    patch: itemPatchSchema.optional(),
    share: z.number().finite().min(0).max(100).nullable().optional(),
  }).strict(),
  z.object({ type: z.literal('update'), id: idSchema, patch: itemPatchSchema }).strict(),
  z.object({ type: z.literal('delete'), id: idSchema }).strict(),
  z.object({ type: z.literal('delete-many'), ids: z.array(idSchema).min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('move'), id: idSchema, parentId: nullableParentSchema }).strict(),
  z.object({ type: z.literal('arrange'), ids: z.array(idSchema).min(1).max(10_000), parentId: nullableParentSchema, beforeId: idSchema.optional() }).strict(),
  z.object({ type: z.literal('restore-arrangement'), placements: z.array(z.object(placementShape).strict()).max(10_000),
    expected: z.array(z.object({ ...placementShape, included: z.boolean() }).strict()).max(10_000) }).strict(),
  z.object({
    type: z.literal('reorder'),
    parentId: nullableParentSchema,
    ids: z.array(idSchema).max(10_000),
  }).strict(),
  z.object({
    type: z.literal('allocate'),
    id: idSchema,
    share: z.number().finite().min(0).max(100).nullable(),
    siblingIds: z.array(idSchema).min(2).max(10_000).optional(),
  }).strict(),
  z.object({
    type: z.literal('bulk'),
    ids: z.array(idSchema).min(1).max(10_000),
    patch: itemPatchSchema,
  }).strict(),
]);

const itemSchema = z.object({
  id: idSchema,
  parentId: nullableParentSchema,
  order: z.number().int(),
  title: z.string(),
  status: statusSchema,
  properties: z.record(idSchema, idSchema.nullable()).optional(),
  notes: z.string(),
  included: z.boolean(),
  weight: finiteNonNegativeSchema,
  allocationAuto: z.boolean().optional(),
  effortOverride: finiteNonNegativeSchema.nullable(),
  defaultPromptId: idSchema.nullable().optional(),
  resourceUri: resourceUriSchema.nullable().optional(),
}).strict();

const periodSchema = z.object({
  id: idSchema,
  name: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
}).strict();

const checkpointSchema = z.enum(['opening', 'planned', 'closing']);
const snapshotSummarySchema = z.object({
  id: idSchema,
  periodId: idSchema,
  kind: checkpointSchema,
  capturedAt: z.string(),
  updatedAt: z.string(),
}).strict();

const widgetSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  description: z.string(),
}).strict();

export const promptTemplateSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(500),
  prompt: z.string().min(1).max(100_000).refine(value => Boolean(value.trim()) && !value.includes('\0')),
}).strict();
export const deletePromptTemplateInputSchema = z.object({ id: idSchema }).strict();

export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(1).max(500),
  lifecyclePropertyId: idSchema.nullable(),
  properties: z.array(z.object({
    id: idSchema, name: z.string().trim().min(1).max(500),
    unsetLabel: z.string().trim().min(1).max(500), unsetColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    defaultValue: idSchema.nullable(),
    unsetShowByDefault: z.boolean().optional(),
    inheritFromParent: z.boolean().optional(),
    fallbackValue: idSchema.optional(),
    options: z.array(z.object({
      id: idSchema, label: z.string().trim().min(1).max(500), color: z.string().regex(/^#[0-9a-f]{6}$/i),
      behavior: z.enum(['normal', 'complete', 'skip']).optional(),
      showByDefault: z.boolean().optional(),
    }).strict()).max(500),
  }).strict()).max(100),
}).strict();
export const saveSettingsInputSchema = z.object({
  settings: workspaceSettingsSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
  replacements: z.record(idSchema, z.record(idSchema, idSchema.nullable())).optional(),
}).strict();

export const workspaceSchema = z.object({
  settings: workspaceSettingsSchema,
  dashboard: z.object({
    items: z.array(itemSchema),
    periodId: idSchema,
    snapshotId: idSchema.nullable(),
    revision: z.number().int().nonnegative(),
  }).strict(),
  periods: z.array(periodSchema),
  snapshots: z.array(snapshotSummarySchema),
  widgets: z.array(widgetSummarySchema),
  promptTemplates: z.array(promptTemplateSchema),
  recycleBin: z.array(z.object({ id: idSchema, title: z.string(), parentId: nullableParentSchema,
    deletedAt: z.string(), itemCount: z.number().int().positive() }).strict()).optional(),
}).strict();

export const viewInputSchema = z.object({ snapshotId: idSchema.optional() }).strict();
export const mutationInputSchema = viewInputSchema.extend({
  expectedRevision: z.number().int().nonnegative().optional(),
  command: itemCommandSchema,
}).strict();
export const planInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative().optional(),
}).strict();
export const restoreDeletedInputSchema = planInputSchema.extend({ id: idSchema }).strict();
export const rolloverInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
}).strict();
export const widgetRenderInputSchema = z.object({
  widgetId: idSchema,
  itemId: idSchema,
  snapshotId: idSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const widgetActionInputSchema = widgetRenderInputSchema.extend({
  action: idSchema,
  input: z.unknown().optional(),
}).strict();

const widgetRenderResultSchema = z.object({ html: z.string() }).strict();
const widgetActionResultSchema = z.object({
  message: z.string().optional(),
  result: z.unknown().optional(),
}).strict();

export const rpcContract = {
  workspace: { input: viewInputSchema, output: workspaceSchema },
  mutate: { input: mutationInputSchema, output: workspaceSchema },
  restoreDeleted: { input: restoreDeletedInputSchema, output: workspaceSchema },
  saveSettings: { input: saveSettingsInputSchema, output: workspaceSchema },
  plan: { input: planInputSchema, output: workspaceSchema },
  rollover: { input: rolloverInputSchema, output: workspaceSchema },
  widget_render: { input: widgetRenderInputSchema, output: widgetRenderResultSchema },
  widget_action: { input: widgetActionInputSchema, output: widgetActionResultSchema },
  listPromptTemplates: { input: z.object({}).strict(), output: z.array(promptTemplateSchema) },
  savePromptTemplate: { input: promptTemplateSchema, output: promptTemplateSchema },
  deletePromptTemplate: { input: deletePromptTemplateInputSchema, output: z.void() },
} as const;

export interface WidgetRegistrySurface {
  summaries(): WidgetSummary[];
  render(input: WidgetRenderInput): Promise<WidgetRenderResult>;
  action(input: WidgetActionInput): Promise<WidgetActionResult>;
}

export interface LifeManagerActions {
  workspace(input?: ViewInput): Workspace;
  mutate(input: MutationInput): Workspace;
  restoreDeleted(input: RestoreDeletedInput): Workspace;
  saveSettings(input: SaveSettingsInput): Workspace;
  plan(input?: { expectedRevision?: number }): Workspace;
  rollover(input?: { name?: string; expectedRevision?: number }): Workspace;
  exportData(): ReturnType<LifeManagerStore['exportData']>;
  listPromptTemplates(): PromptTemplate[];
  savePromptTemplate(template: PromptTemplate): PromptTemplate;
  deletePromptTemplate(input: { id: string }): void;
}

export function createLifeManagerActions(
  store: LifeManagerStore,
  getWidgets: () => WidgetSummary[] = () => [],
  publish: (payload: Record<string, unknown>) => void = () => {},
): LifeManagerActions {
  return {
    workspace(input = {}) {
      return store.workspace(viewInputSchema.parse(input), getWidgets());
    },
    mutate(input) {
      const result = store.mutate(mutationInputSchema.parse(input), getWidgets());
      if (result.changed) {
        publish({
          operation: 'mutate',
          revision: result.workspace.dashboard.revision,
          snapshotId: result.workspace.dashboard.snapshotId,
        });
      }
      return result.workspace;
    },
    restoreDeleted(input) {
      const result = store.restoreDeleted(restoreDeletedInputSchema.parse(input), getWidgets());
      publish({ operation: 'restoreDeleted', revision: result.workspace.dashboard.revision });
      return result.workspace;
    },
    saveSettings(input) {
      const result = store.saveSettings(saveSettingsInputSchema.parse(input), getWidgets());
      if (result.changed) publish({ operation: 'saveSettings', revision: result.workspace.dashboard.revision });
      return result.workspace;
    },
    plan(input = {}) {
      const result = store.plan(planInputSchema.parse(input).expectedRevision, getWidgets());
      publish({ operation: 'plan', revision: result.workspace.dashboard.revision });
      return result.workspace;
    },
    rollover(input = {}) {
      const result = store.rollover(rolloverInputSchema.parse(input), getWidgets());
      publish({
        operation: 'rollover',
        revision: result.workspace.dashboard.revision,
        periodId: result.workspace.dashboard.periodId,
      });
      return result.workspace;
    },
    listPromptTemplates() {
      return store.listPromptTemplates();
    },
    savePromptTemplate(template) {
      const result = store.savePromptTemplate(promptTemplateSchema.parse(template));
      publish({ operation: 'savePromptTemplate', id: result.id });
      return result;
    },
    deletePromptTemplate(input) {
      const { id } = deletePromptTemplateInputSchema.parse(input);
      store.deletePromptTemplate(id);
      publish({ operation: 'deletePromptTemplate', id });
    },
    exportData() {
      return store.exportData();
    },
  };
}
