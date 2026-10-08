import type { Item, ItemPlacement, WorkspaceSettings } from '../src/types';
import { viewComparator, type ViewSort } from './view-sort';

export function placement(item: Item): ItemPlacement {
  return { id: item.id, parentId: item.parentId, order: item.order, weight: item.weight, ...(item.allocationAuto ? { allocationAuto: true } : {}) };
}

/** Search keeps ancestor context; expansion and inclusion never mutate each other. */
export function outlineModel(items: Item[], expanded: Set<string>, all: boolean, query: string, settings: WorkspaceSettings, sort: ViewSort, propertyId?: string | null, matchingIds?: ReadonlySet<string>) {
  const byId = new Map(items.map(item => [item.id, item]));
  const children = new Map<string | null, Item[]>();
  for (const item of items) {
    const group = children.get(item.parentId) ?? [];
    group.push(item); children.set(item.parentId, group);
  }
  const compare = viewComparator(items, sort, settings, propertyId);
  for (const group of children.values()) group.sort(compare);
  const visible = new Set<string>();
  const visit = (parentId: string | null, parentIncluded: boolean) => {
    for (const item of children.get(parentId) ?? []) {
      const included = parentIncluded && item.included;
      if (included) visible.add(item.id);
      visit(item.id, included);
    }
  };
  visit(null, true);
  const queryText = query.trim().toLocaleLowerCase();
  const matches = new Set(items.filter(item => (all || visible.has(item.id)) && (!matchingIds || matchingIds.has(item.id)) && item.title.toLocaleLowerCase().includes(queryText)).map(item => item.id));
  const context = new Set(matches);
  for (const id of matches) {
    let parent = byId.get(id)?.parentId;
    while (parent) { context.add(parent); parent = byId.get(parent)?.parentId; }
  }
  const filtering = Boolean(queryText) || matchingIds !== undefined;
  const eligible = (item: Item) => (all || visible.has(item.id)) && (!filtering || context.has(item.id));
  const rows: { item: Item; depth: number; hasChildren: boolean; open: boolean; contextOnly: boolean }[] = [];
  const flatten = (parentId: string | null, depth: number) => {
    for (const item of children.get(parentId) ?? []) {
      if (!eligible(item)) continue;
      const hasChildren = (children.get(item.id) ?? []).some(eligible);
      const open = filtering || expanded.has(item.id);
      rows.push({ item, depth, hasChildren, open, contextOnly: filtering && !matches.has(item.id) });
      if (open) flatten(item.id, depth + 1);
    }
  };
  flatten(null, 0);
  return { rows, children, visible, filtering };
}
