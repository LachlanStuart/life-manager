import type { AgentReply, Item, ItemCommand, WorkspaceSettings, WidgetSummary, WidgetRenderInput, WidgetActionInput, WidgetRenderResult, WidgetActionResult, PromptTemplate, PromptHandling } from '../src/types';

import type { ViewSort } from './view-sort';

export type WheelMode = 'Navigate' | 'Omni' | 'Importance' | 'Effort' | 'Create';

export interface SunburstProps {
  settings?: WorkspaceSettings; colorPropertyId?: string | null;
  items: Item[]; selectedId: string | null; focusId: string | null; showAll: boolean;
  onSelect: (id: string) => void; onHighlight?: (id: string) => void; onFocus: (id: string | null) => void;
  onAllocate: (id: string, share: number) => void; disabled?: boolean;
  mode?: WheelMode;
  sort?: ViewSort;
  compact?: boolean;
  onEffort?: (id: string, effort: number) => void;
  onCreate?: (parentId: string) => void;
  onShowHidden?: () => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
}
export interface NotesEditorProps {
  itemId: string; value: string; readOnly?: boolean; snapshotId?: string;
  onChange: (markdown: string) => void;
  uploadImage?: (file: File) => Promise<string>;
  widgets: WidgetSummary[];
  renderWidget: (input: WidgetRenderInput) => Promise<WidgetRenderResult>;
  actWidget: (input: WidgetActionInput) => Promise<WidgetActionResult>;
  onOpenItem: (id: string) => void;
}
export interface ItemPanelProps extends Omit<NotesEditorProps, 'itemId' | 'value' | 'onChange'> {
  item: Item; items: Item[]; showAll: boolean; settings?: WorkspaceSettings; propertyId?: string | null;
  onCommand: (command: ItemCommand) => Promise<void>;
  onSelect: (id: string) => void;
  onNotesChange: (id: string, markdown: string) => void;
  notesStatus?: string;
  promptTemplates?: PromptTemplate[];
  promptHandling?: PromptHandling;
  onSendToAgent?: (itemId: string, templateId: string) => Promise<AgentReply>;
}
