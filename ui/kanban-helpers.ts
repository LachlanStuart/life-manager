import { childrenOf, siblingShares } from '../src/domain';
import { STATUS_ORDER, viewComparator, type ViewSort } from './view-sort';
import { DEFAULT_WORKSPACE_SETTINGS, effectivePropertyValue } from '../src/properties';
import { NEUTRAL_PROPERTY_COLOR, presentationProperty } from './property-presentation';
import { propertyChoices } from './PropertySelect';
import type { Item, WorkspaceSettings } from '../src/types';

/** The board keeps the working states together and leaves archival states at the end. */
export const KANBAN_STATUS_ORDER = STATUS_ORDER;

export const KANBAN_CARD_MIN_HEIGHT = 32;
export const KANBAN_CARD_SHARE_HEIGHT = 320;
export const KANBAN_CARD_MIN_FONT_SIZE = 12;
export const KANBAN_CARD_MAX_FONT_SIZE = 22;

export type KanbanDropPosition = 'before' | 'after';

export interface KanbanCard {
  item: Item;
  share: number;
  height: number;
  fontSize: number;
  parentPath: Item[];
}

export interface KanbanGroup {
  key: string;
  parentId: string | null;
  parentPath: Item[];
  cards: KanbanCard[];
}

export interface KanbanColumn {
  status: string | null;
  label: string;
  color: string;
  groups: KanbanGroup[];
}

export interface KanbanBoardModel {
  cards: KanbanCard[];
  columns: KanbanColumn[];
}

function itemIndex(items: readonly Item[]): Map<string, Item> {
  return new Map(items.map((item) => [item.id, item]));
}

function isEffectivelyIncluded(byId: ReadonlyMap<string, Item>, item: Item): boolean {
  const seen = new Set<string>();
  let cursor: Item | undefined = item;
  while (cursor) {
    if (seen.has(cursor.id) || !cursor.included) return false;
    seen.add(cursor.id);
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return true;
}

function pathToParent(
  byId: ReadonlyMap<string, Item>,
  parentId: string | null,
  stopId: string | null,
): Item[] {
  const path: Item[] = [];
  const seen = new Set<string>();
  let cursor = parentId === null ? undefined : byId.get(parentId);
  while (cursor && !seen.has(cursor.id)) {
    path.unshift(cursor);
    seen.add(cursor.id);
    if (cursor.id === stopId) break;
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return path;
}

/**
 * Return effectively included descendants with no included children, in tree order.
 * Parents remain navigation/grouping context; childless or fully deferred branches
 * appear as cards themselves. The focused Item itself is not a card.
 */
export function kanbanItems(items: readonly Item[], focusId: string | null, sort: ViewSort = 'Order', settings: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS, propertyId?: string | null, showAll = false): Item[] {
  const compare = viewComparator(items, sort, settings, propertyId);
  const byId = itemIndex(items);
  const roots = focusId === null
    ? childrenOf(items, null)
    : childrenOf(items, focusId);
  const result: Item[] = [];
  const visit = (item: Item) => {
    if (!showAll && !isEffectivelyIncluded(byId, item)) return;
    const children = childrenOf(items, item.id).filter((child) => showAll || child.included);
    if (children.length === 0) result.push(item);
    else for (const child of children.sort(compare)) visit(child);
  };
  for (const root of roots.sort(compare)) visit(root);
  return result;
}

/**
 * Calculate a card's attention share within the focused branch. Shares are products
 * of each local sibling allocation, so deeper cards remain meaningful without making
 * parent and child cards add up as if they occupied the same level.
 */
export function branchRelativeShares(items: readonly Item[], focusId: string | null): Map<string, number> {
  const byId = itemIndex(items);
  const shares = new Map<string, number>();

  const groups = new Map<string | null, Item[]>();
  for (const item of items) {
    const siblings = groups.get(item.parentId) ?? [];
    siblings.push(item); groups.set(item.parentId, siblings);
  }
  const local = new Map<string, number>();
  for (const siblings of groups.values()) for (const [id, share] of siblingShares(siblings)) local.set(id, share / 100);
  const roots = focusId === null ? childrenOf(items, null) : childrenOf(items, focusId);

  const visit = (item: Item, share: number) => {
    if (!isEffectivelyIncluded(byId, item)) return;
    shares.set(item.id, share);
    const children = childrenOf(items, item.id).filter((child) => isEffectivelyIncluded(byId, child));
    if (children.length === 0) return;
    for (const child of children) {
      const fraction = local.get(child.id) ?? 0;
      visit(child, share * fraction);
    }
  };
  for (const root of roots) visit(root, local.get(root.id) ?? 0);
  return shares;
}

/** Build the visual columns and parent-path groups used by the board. */
export function buildKanbanModel(items: readonly Item[], focusId: string | null, sort: ViewSort = 'Order', settings: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS, groupPropertyId?: string | null, matchingIds?: ReadonlySet<string>, showAll = false): KanbanBoardModel {
  const byId = itemIndex(items);
  const shares = branchRelativeShares(items, focusId);
  const property = presentationProperty(settings, groupPropertyId);
  const visible = kanbanItems(items, focusId, sort, settings, groupPropertyId, showAll).filter(item => !matchingIds || matchingIds.has(item.id));
  const cards = visible.map((item): KanbanCard => {
    const share = Math.max(0, Math.min(1, shares.get(item.id) ?? 0));
    return {
      item,
      share,
      height: KANBAN_CARD_MIN_HEIGHT + share * KANBAN_CARD_SHARE_HEIGHT,
      fontSize: KANBAN_CARD_MIN_FONT_SIZE + share * (KANBAN_CARD_MAX_FONT_SIZE - KANBAN_CARD_MIN_FONT_SIZE),
      parentPath: pathToParent(byId, item.parentId, focusId),
    };
  });
  const choices = property ? propertyChoices(property) : [];
  const columns = property
    ? [...choices.filter(choice => choice.id !== null), ...choices.filter(choice => choice.id === null)]
      .map(choice => ({ status: choice.id, label: choice.label, color: choice.color }))
    : [{ status: null, label: 'Items', color: NEUTRAL_PROPERTY_COLOR }];
  const byStatus = new Map<string | null, KanbanCard[]>(columns.map(column => [column.status, []]));
  for (const card of cards) {
    const value = property ? effectivePropertyValue(card.item, property) : null;
    (byStatus.get(value) ?? byStatus.get(null)!).push(card);
  }
  return {
    cards,
    columns: columns.map((column) => {
      const groups = new Map<string, KanbanGroup>();
      for (const card of byStatus.get(column.status)!) {
        const parentId = card.item.parentId;
        const key = parentId ?? '__top-level__';
        let group = groups.get(key);
        if (!group) {
          group = {
            key,
            parentId,
            parentPath: card.parentPath,
            cards: [],
          };
          groups.set(key, group);
        }
        group.cards.push(card);
      }
      return { ...column, groups: [...groups.values()] };
    }).filter(column => !matchingIds || column.groups.length > 0),
  };
}

/**
 * Reorder a full sibling list around a same-parent target. The returned IDs include
 * hidden siblings and siblings in other lifecycle columns, as required by the API.
 */
export function reorderedSiblingIds(
  items: readonly Item[],
  movingId: string,
  targetId: string,
  position: KanbanDropPosition,
): string[] | null {
  const moving = items.find((item) => item.id === movingId);
  const target = items.find((item) => item.id === targetId);
  if (!moving || !target || moving.id === target.id || moving.parentId !== target.parentId) return null;
  const ids = childrenOf(items, moving.parentId).map((item) => item.id);
  const sourceIndex = ids.indexOf(movingId);
  if (sourceIndex < 0) return null;
  ids.splice(sourceIndex, 1);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0) return null;
  ids.splice(targetIndex + (position === 'after' ? 1 : 0), 0, movingId);
  return ids;
}
