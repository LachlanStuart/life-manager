import type { Item } from '../src/types';
import { childrenOf } from '../src/domain';

export function ancestorTrail(items: Item[], item: Item): Item[] {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  const trail: Item[] = [];
  const visited = new Set([item.id]);
  let parentId = item.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || visited.has(parent.id)) break;
    trail.unshift(parent);
    visited.add(parent.id);
    parentId = parent.parentId;
  }
  return trail;
}

export function descendantsOf(items: Item[], rootId: string): Set<string> {
  const descendants = new Set([rootId]);
  const pending = [rootId];
  while (pending.length) {
    for (const child of childrenOf(items, pending.pop()!)) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id);
        pending.push(child.id);
      }
    }
  }
  descendants.delete(rootId);
  return descendants;
}

export function moveParentOptions(items: Item[], item: Item) {
  const descendants = descendantsOf(items, item.id);
  return items.filter(candidate => candidate.id !== item.id && !descendants.has(candidate.id))
    .map(candidate => ({ id: candidate.id, label: [...ancestorTrail(items, candidate), candidate].map(part => part.title).join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
