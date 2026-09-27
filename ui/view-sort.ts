import { computeEfforts, siblingShares } from '../src/domain';
import type { Item, Status } from '../src/types';

export const VIEW_SORTS = ['Order', 'Status', 'Importance', 'Effort'] as const;
export type ViewSort = typeof VIEW_SORTS[number];
export const STATUS_ORDER: readonly Status[] = ['Now', 'Doing', 'Blocked', 'Done', 'Later', 'Skip', 'Cut'];

/** A presentation-only sibling comparison. Ties retain the saved order. */
export function viewComparator(items: readonly Item[], sort: ViewSort = 'Order'): (a: Item, b: Item) => number {
  const values = new Map<string, number>();
  if (sort === 'Importance') {
    const groups = new Map<string | null, Item[]>();
    for (const item of items) {
      const group = groups.get(item.parentId) ?? [];
      group.push(item); groups.set(item.parentId, group);
    }
    for (const group of groups.values()) for (const [id, share] of siblingShares(group)) values.set(id, share);
  } else if (sort === 'Effort') {
    for (const [id, effort] of Object.entries(computeEfforts(items))) values.set(id, effort);
  }
  return (a, b) => {
    const difference = sort === 'Status' ? STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      : sort === 'Order' ? 0 : (values.get(b.id) ?? 0) - (values.get(a.id) ?? 0);
    return difference || a.order - b.order || a.title.localeCompare(b.title);
  };
}
