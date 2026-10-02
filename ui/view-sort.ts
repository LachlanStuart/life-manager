import { computeEfforts, siblingShares } from '../src/domain';
import { DEFAULT_WORKSPACE_SETTINGS, propertyValue } from '../src/properties';
import { presentationProperty } from './property-presentation';
import type { Item, Status, WorkspaceSettings } from '../src/types';

export const VIEW_SORTS = ['Order', 'Status', 'Importance', 'Effort'] as const;
export type ViewSort = typeof VIEW_SORTS[number];
export const STATUS_ORDER: readonly Status[] = ['Now', 'Doing', 'Blocked', 'Done', 'Later', 'Skip', 'Cut'];

/** A presentation-only sibling comparison. Ties retain the saved order. */
export function viewComparator(items: readonly Item[], sort: ViewSort = 'Order', settings: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS, propertyId?: string | null): (a: Item, b: Item) => number {
  const values = new Map<string, number>();
  const property = presentationProperty(settings, propertyId);
  const rank = (item: Item) => {
    if (!property) return 0;
    const index = property.options.findIndex(option => option.id === propertyValue(item, property.id));
    return index < 0 ? property.options.length : index;
  };
  if (sort === 'Importance') {
    const groups = new Map<string | null, Item[]>();
    for (const item of items) {
      const group = groups.get(item.parentId) ?? [];
      group.push(item); groups.set(item.parentId, group);
    }
    for (const group of groups.values()) for (const [id, share] of siblingShares(group)) values.set(id, share);
  } else if (sort === 'Effort') {
    for (const [id, effort] of Object.entries(computeEfforts(items, settings))) values.set(id, effort);
  }
  return (a, b) => {
    const difference = sort === 'Status' ? rank(a) - rank(b)
      : sort === 'Order' ? 0 : (values.get(b.id) ?? 0) - (values.get(a.id) ?? 0);
    return difference || a.order - b.order || a.title.localeCompare(b.title);
  };
}
