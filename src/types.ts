export const STATUSES = ['Later', 'Now', 'Doing', 'Blocked', 'Done', 'Skip', 'Cut'] as const;
/** Generous bound for Markdown notes, including extension configuration. */
export const MAX_NOTES_CHARS = 6 * 1024 * 1024;
export type Status = typeof STATUSES[number];
export interface Item {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  status: string | null;
  properties?: Record<string, string | null>;
  /** Markdown, including embedded widget directives and managed attachment links. */
  notes: string;
  /** A null or absent default inherits the nearest ancestor’s configured prompt. */
  defaultPromptId?: string | null;
  /** Saved reference to one file or folder, independent of transient widget listings. */
  resourceUri?: string | null;
  included: boolean;
  /** Relative weight, or explicit percent in a sibling group containing automatic allocations. */
  weight: number;
  /** True splits the remainder after explicit siblings; absent means legacy/manual allocation. */
  allocationAuto?: boolean;
  effortOverride: number | null;
}
export type ItemPatch = Partial<Pick<Item, 'title' | 'status' | 'properties' | 'notes' | 'included' | 'weight' | 'allocationAuto' | 'effortOverride' | 'defaultPromptId' | 'resourceUri'>>;
export type ItemPlacement = Pick<Item, 'id' | 'parentId' | 'order' | 'weight' | 'allocationAuto'>;
export type ItemCommand =
  | { type: 'create'; id?: string; parentId: string | null; title: string; patch?: ItemPatch; share?: number | null }
  | { type: 'update'; id: string; patch: ItemPatch }
  | { type: 'delete'; id: string }
  | { type: 'delete-many'; ids: string[] }
  | { type: 'move'; id: string; parentId: string | null }
  | { type: 'arrange'; ids: string[]; parentId: string | null; beforeId?: string }
  | { type: 'restore-arrangement'; placements: ItemPlacement[]; expected: (ItemPlacement & { included: boolean })[] }
  | { type: 'reorder'; parentId: string | null; ids: string[] }
  | { type: 'allocate'; id: string; share: number | null; siblingIds?: string[] }
  | { type: 'bulk'; ids: string[]; patch: ItemPatch };
export interface Period { id: string; name: string; openedAt: string; closedAt: string | null }
export type Checkpoint = 'opening' | 'planned' | 'closing';
export interface SnapshotSummary { id: string; periodId: string; kind: Checkpoint; capturedAt: string; updatedAt: string }
export interface Dashboard { items: Item[]; periodId: string; snapshotId: string | null; revision: number }
export interface WidgetSummary { id: string; title: string; description: string }
export interface PromptTemplate { id: string; name: string; prompt: string }
export type PromptHandling = 'modal' | 'codex' | 't3';
export interface T3LaunchReply { copied: boolean; opened: boolean; location: 'server' | 'device'; error?: string }
export interface AgentReply {
  message: string;
  prompt: string;
  url?: string;
}
export interface EnumOption { id: string; label: string; color: string; behavior?: 'normal' | 'complete' | 'skip'; showByDefault?: boolean }
export interface EnumProperty { id: string; name: string; options: EnumOption[]; unsetLabel: string; unsetColor: string; defaultValue: string | null; unsetShowByDefault?: boolean }
export interface WorkspaceSettings { name: string; properties: EnumProperty[]; lifecyclePropertyId: string | null }
export interface SaveSettingsInput { settings: WorkspaceSettings; expectedRevision?: number; replacements?: Record<string, Record<string, string | null>> }
export interface DeletedItemSummary { id: string; title: string; parentId: string | null; deletedAt: string; itemCount: number }
export interface RestoreDeletedInput { id: string; expectedRevision?: number }
export interface Workspace { settings?: WorkspaceSettings; dashboard: Dashboard; periods: Period[]; snapshots: SnapshotSummary[]; widgets: WidgetSummary[]; promptTemplates: PromptTemplate[]; recycleBin?: DeletedItemSummary[] }
export interface ViewInput { snapshotId?: string }
export interface MutationInput extends ViewInput { expectedRevision?: number; command: ItemCommand }
export interface WidgetContext { itemId: string; snapshotId?: string; config?: Record<string, unknown> }
export interface WidgetRenderInput extends WidgetContext { widgetId: string }
export interface WidgetActionInput extends WidgetRenderInput { action: string; input?: unknown }
export interface WidgetRenderResult { html: string }
export interface WidgetActionResult { message?: string; result?: unknown }
export const CHANGED = 'life-manager-changed';
