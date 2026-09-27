import { MAX_NOTES_CHARS, STATUSES, type Item, type ItemCommand, type ItemPatch } from './types';

const statusSet = new Set<string>(STATUSES);

function fail(message: string): never {
  throw new Error(message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a nonempty string`);
  }
}

function assertParentId(value: unknown, label: string): asserts value is string | null {
  if (value !== null) assertId(value, label);
}

function assertNonNegativeFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a finite nonnegative number`);
  }
}

function assertPatch(patch: unknown, label = 'patch'): asserts patch is ItemPatch {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    fail(`${label} must be an object`);
  }

  const candidate = patch as Record<string, unknown>;
  if ('title' in candidate) {
    if (typeof candidate.title !== 'string' || candidate.title.trim() === '') {
      fail(`${label}.title must be a nonempty string`);
    }
  }
  if ('status' in candidate &&
      (typeof candidate.status !== 'string' || !statusSet.has(candidate.status))) {
    fail(`${label}.status is invalid`);
  }
  if ('notes' in candidate && (typeof candidate.notes !== 'string' || candidate.notes.length > MAX_NOTES_CHARS)) {
    fail(`${label}.notes must be a string of at most ${MAX_NOTES_CHARS} characters`);
  }
  for (const field of ['defaultPromptId', 'resourceUri'] as const) {
    if (field in candidate && candidate[field] != null) {
      assertId(candidate[field], `${label}.${field}`);
      const value = candidate[field] as string;
      if (value.length > (field === 'defaultPromptId' ? 200 : 8192) || value.includes('\0')) {
        fail(`${label}.${field} is invalid`);
      }
    }
  }
  if ('included' in candidate && typeof candidate.included !== 'boolean') {
    fail(`${label}.included must be a boolean`);
  }
  if ('weight' in candidate) assertNonNegativeFinite(candidate.weight, `${label}.weight`);
  if ('effortOverride' in candidate && candidate.effortOverride !== null) {
    assertNonNegativeFinite(candidate.effortOverride, `${label}.effortOverride`);
  }
}

function itemIndex(items: readonly Item[]): Map<string, Item> {
  const byId = new Map<string, Item>();
  for (const item of items) {
    assertId(item.id, 'item.id');
    if (byId.has(item.id)) fail(`Duplicate item id: ${item.id}`);
    byId.set(item.id, item);
  }
  return byId;
}

function validateItems(items: readonly Item[]): Map<string, Item> {
  const byId = itemIndex(items);

  for (const item of items) {
    assertParentId(item.parentId, `parentId for ${item.id}`);
    if (item.parentId !== null && !byId.has(item.parentId)) {
      fail(`Invalid parent ${item.parentId} for item ${item.id}`);
    }
    if (typeof item.order !== 'number' || !Number.isFinite(item.order)) {
      fail(`order for ${item.id} must be finite`);
    }
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      fail(`title for ${item.id} must be nonempty`);
    }
    if (!statusSet.has(item.status)) fail(`status for ${item.id} is invalid`);
    assertPatch(item, `item ${item.id}`);
    if (typeof item.included !== 'boolean') fail(`included for ${item.id} must be a boolean`);
    assertNonNegativeFinite(item.weight, `weight for ${item.id}`);
    if (item.allocationAuto !== undefined && typeof item.allocationAuto !== 'boolean') fail(`allocationAuto for ${item.id} must be a boolean`);
    if (item.effortOverride !== null) {
      assertNonNegativeFinite(item.effortOverride, `effortOverride for ${item.id}`);
    }
  }

  for (const item of items) {
    const seen = new Set<string>();
    let cursor: Item | undefined = item;
    while (cursor !== undefined) {
      if (seen.has(cursor.id)) fail(`Item hierarchy contains a cycle at ${cursor.id}`);
      seen.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
  }

  return byId;
}

function requireItem(byId: ReadonlyMap<string, Item>, id: string): Item {
  assertId(id, 'id');
  const item = byId.get(id);
  if (item === undefined) fail(`Unknown item id: ${id}`);
  return item;
}

/** Return an Item's direct children in sibling order. */
export function childrenOf(items: readonly Item[], parentId: string | null): Item[] {
  return items
    .filter((item) => item.parentId === parentId)
    .sort((left, right) => left.order - right.order);
}

/** Whether an Item and every ancestor are included in the current dashboard. */
export function effectiveIncluded(items: readonly Item[], id: string): boolean {
  const byId = validateItems(items);
  let cursor: Item | undefined = requireItem(byId, id);
  while (cursor !== undefined) {
    if (!cursor.included) return false;
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return true;
}

/** One allocation projection shared by the wheel, board, inputs, and effort rollups. */
export function siblingShares(siblings: readonly Item[]): Map<string, number> {
  const included = siblings.filter(item => item.included);
  const automatic = included.filter(item => item.allocationAuto);
  const explicit = included.filter(item => !item.allocationAuto);
  const total = explicit.reduce((sum, item) => sum + item.weight, 0);
  const shares = new Map(siblings.map(item => [item.id, 0]));
  if (automatic.length) {
    const scale = total > 100 ? 100 / total : 1;
    for (const item of explicit) shares.set(item.id, item.weight * scale);
    const remainder = Math.max(0, 100 - total) / automatic.length;
    for (const item of automatic) shares.set(item.id, remainder);
  } else {
    for (const item of included) shares.set(item.id, total === 0 ? 100 / included.length : item.weight / total * 100);
  }
  return shares;
}

/** Largest explicit share that leaves the other explicit shares intact while blanks remain. */
export function allocationLimit(items: readonly Item[], id: string): number {
  const item = items.find(item => item.id === id);
  if (!item) return 100;
  const others = items.filter(other => other.parentId === item.parentId && other.included && other.id !== id);
  return others.some(other => other.allocationAuto)
    ? Math.max(0, 100 - others.filter(other => !other.allocationAuto).reduce((sum, other) => sum + other.weight, 0)) : 100;
}

/** The Item's percentage among its locally included siblings. */
export function localShare(items: readonly Item[], id: string): number {
  const byId = validateItems(items);
  const item = requireItem(byId, id);
  if (!item.included) return 0;

  const siblings = items.filter(
    (candidate) => candidate.parentId === item.parentId && candidate.included,
  );
  return siblingShares(siblings).get(id) ?? 0;
}

/** Calculate every local branch, including branches suppressed by an excluded ancestor. */
export function computeEfforts(items: readonly Item[]): Record<string, number> {
  validateItems(items);
  const children = new Map<string | null, Item[]>();
  for (const item of items) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }

  const efforts: Record<string, number> = Object.create(null) as Record<string, number>;
  const calculate = (item: Item): number => {
    const cached = efforts[item.id];
    if (cached !== undefined) return cached;

    let effort: number;
    if (item.effortOverride !== null) {
      effort = item.effortOverride;
    } else if (item.status === 'Skip' || item.status === 'Cut') {
      effort = 0;
    } else {
      const includedChildren = (children.get(item.id) ?? []).filter((child) => child.included);
      if (includedChildren.length === 0) {
        effort = item.status === 'Done' ? 100 : 0;
      } else {
        const shares = siblingShares(includedChildren);
        effort = includedChildren.reduce((sum, child) => sum + calculate(child) * shares.get(child.id)! / 100, 0);
      }
    }
    efforts[item.id] = effort;
    return effort;
  };

  for (const item of items) calculate(item);
  return efforts;
}

function nextOrder(items: readonly Item[], parentId: string | null): number {
  const siblings = items.filter((item) => item.parentId === parentId);
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((item) => item.order)) + 1;
}

function generatedId(items: readonly Item[]): string {
  const existing = new Set(items.map((item) => item.id));
  let id: string;
  do {
    id = globalThis.crypto.randomUUID();
  } while (existing.has(id));
  return id;
}

function assertIds(ids: unknown, label: string): asserts ids is string[] {
  if (!Array.isArray(ids)) fail(`${label} must be an array`);
  const seen = new Set<string>();
  for (const id of ids) {
    assertId(id, `${label} id`);
    if (seen.has(id)) fail(`${label} contains duplicate id ${id}`);
    seen.add(id);
  }
}

/** Apply one validated hierarchy command without mutating the input array or Items. */
export function mutateItems(items: readonly Item[], command: ItemCommand): Item[] {
  const byId = validateItems(items);
  if (command === null || typeof command !== 'object') fail('command must be an object');

  let result: Item[];
  switch (command.type) {
    case 'create': {
      assertParentId(command.parentId, 'parentId');
      if (command.parentId !== null) requireItem(byId, command.parentId);
      if (typeof command.title !== 'string' || command.title.trim() === '') {
        fail('title must be nonempty');
      }
      if (command.patch !== undefined) assertPatch(command.patch);
      const id = command.id ?? generatedId(items);
      assertId(id, 'id');
      if (byId.has(id)) fail(`Duplicate item id: ${id}`);
      const created: Item = {
        id,
        parentId: command.parentId,
        order: nextOrder(items, command.parentId),
        title: command.title,
        status: 'Later',
        notes: '',
        included: true,
        weight: 1,
        allocationAuto: command.patch?.weight === undefined,
        effortOverride: null,
        ...command.patch,
      };
      result = [...items, created];
      if (command.share != null) {
        // Explicit creation uses the same allocation rules atomically.
        const automatic = mutateItems(items, { ...command, id, share: undefined });
        return mutateItems(automatic, { type: 'allocate', id, share: command.share });
      }
      break;
    }
    case 'update': {
      requireItem(byId, command.id);
      assertPatch(command.patch);
      result = items.map((item) => item.id === command.id ? { ...item, ...command.patch } : item);
      break;
    }
    case 'delete':
    case 'delete-many': {
      const ids = command.type === 'delete' ? [command.id] : command.ids;
      assertIds(ids, 'delete ids');
      if (!ids.length) fail('delete ids must not be empty');
      for (const id of ids) requireItem(byId, id);
      const descendants = new Map<string, string[]>();
      for (const item of items) {
        if (item.parentId !== null) {
          const children = descendants.get(item.parentId) ?? [];
          children.push(item.id);
          descendants.set(item.parentId, children);
        }
      }
      const deleted = new Set<string>();
      const pending = [...ids];
      while (pending.length) {
        const id = pending.pop()!;
        if (deleted.has(id)) continue;
        deleted.add(id);
        pending.push(...(descendants.get(id) ?? []));
      }
      result = items.filter((item) => !deleted.has(item.id));
      break;
    }
    case 'move': {
      const item = requireItem(byId, command.id);
      assertParentId(command.parentId, 'parentId');
      if (command.parentId !== null) requireItem(byId, command.parentId);
      if (item.parentId === command.parentId) return items.slice();

      let ancestorId = command.parentId;
      while (ancestorId !== null) {
        if (ancestorId === item.id) fail(`Moving ${item.id} would create a cycle`);
        ancestorId = requireItem(byId, ancestorId).parentId;
      }
      const order = nextOrder(items, command.parentId);
      result = items.map((candidate) =>
        candidate.id === item.id ? { ...candidate, parentId: command.parentId, order } : candidate,
      );
      break;
    }
    case 'reorder': {
      assertParentId(command.parentId, 'parentId');
      if (command.parentId !== null) requireItem(byId, command.parentId);
      assertIds(command.ids, 'reorder ids');
      const siblings = childrenOf(items, command.parentId);
      if (siblings.length !== command.ids.length ||
          siblings.some((item) => !command.ids.includes(item.id))) {
        fail('reorder ids must contain every sibling exactly once');
      }
      const orders = new Map(command.ids.map((id, order) => [id, order]));
      result = items.map((item) => {
        const order = orders.get(item.id);
        return order === undefined ? item : { ...item, order };
      });
      break;
    }
    case 'allocate': {
      const item = requireItem(byId, command.id);
      if (command.share !== null && (typeof command.share !== 'number' || !Number.isFinite(command.share) ||
          command.share < 0 || command.share > 100)) {
        fail('share must be null or a finite percentage from 0 through 100');
      }
      if (command.share === null) {
        result = items.map(candidate => candidate.id === item.id ? { ...candidate, allocationAuto: true } : candidate);
        break;
      }
      if (!item.included) fail(`Cannot allocate excluded item ${item.id}`);
      const siblings = items.filter(
        (candidate) => candidate.parentId === item.parentId && candidate.included,
      );
      if (siblings.length === 1 && command.share !== 100) {
        fail('The only included sibling must have a 100 percent share');
      }
      const others = siblings.filter((sibling) => sibling.id !== item.id);
      if (others.some(sibling => sibling.allocationAuto)) {
        const limit = allocationLimit(items, item.id);
        if (command.share > limit + 1e-9) fail(`Only ${Math.round(limit * 100) / 100}% remains after the other explicit allocations`);
        const share = Math.min(command.share, limit);
        result = items.map(candidate => candidate.id === item.id
          ? { ...candidate, weight: share, allocationAuto: false } : candidate);
        break;
      }
      const otherTotal = others.reduce((sum, sibling) => sum + sibling.weight, 0);
      const remainder = 100 - command.share;
      const weights = new Map<string, number>([[item.id, command.share]]);
      for (const sibling of others) {
        const weight = otherTotal === 0
          ? remainder / others.length
          : remainder * sibling.weight / otherTotal;
        weights.set(sibling.id, weight);
      }
      result = items.map((candidate) => {
        const weight = weights.get(candidate.id);
        return weight === undefined ? candidate : { ...candidate, weight,
          ...(candidate.id === item.id && candidate.allocationAuto ? { allocationAuto: false } : {}) };
      });
      break;
    }
    case 'bulk': {
      assertIds(command.ids, 'bulk ids');
      assertPatch(command.patch);
      for (const id of command.ids) requireItem(byId, id);
      const selected = new Set(command.ids);
      result = items.map((item) => selected.has(item.id) ? { ...item, ...command.patch } : item);
      break;
    }
    default:
      fail(`Unknown command type: ${String((command as { type?: unknown }).type)}`);
  }

  // Materialize legacy ratios only when a group first acquires an automatic Item.
  // Existing snapshots stay untouched until an explicit correction mutates them.
  const autoParents = new Set(result.filter(item => item.allocationAuto).map(item => item.parentId));
  for (const parentId of autoParents) {
    const before = items.filter(item => item.parentId === parentId);
    if (!before.some(item => item.allocationAuto)) {
      const included = before.filter(item => item.included);
      const total = included.reduce((sum, item) => sum + item.weight, 0);
      const weights = new Map(before.map(item => [item.id, total === 0
        ? (included.length ? 100 / included.length : item.weight) : item.weight / total * 100]));
      result = result.map(item => item.parentId === parentId && weights.has(item.id)
        ? { ...item, weight: weights.get(item.id)! } : item);
    }
    const siblings = result.filter(item => item.parentId === parentId && item.included);
    const explicitTotal = siblings.filter(item => !item.allocationAuto).reduce((sum, item) => sum + item.weight, 0);
    // Re-including/moving Items may overfill a group; fit explicit shares proportionally.
    if (siblings.some(item => item.allocationAuto) && explicitTotal > 100) {
      result = result.map(item => item.parentId === parentId && item.included && !item.allocationAuto
        ? { ...item, weight: item.weight * 100 / explicitTotal } : item);
    }
  }
  validateItems(result);
  return result;
}

/** The empty workspace starts with only the four stable top-level Topics. */
export function seedItems(): Item[] {
  return ['tend', 'build', 'learn', 'enjoy'].map((id, order) => ({
    id,
    parentId: null,
    order,
    title: id[0]!.toUpperCase() + id.slice(1),
    status: 'Later',
    notes: '',
    included: true,
    weight: 1,
    allocationAuto: true,
    effortOverride: null,
  }));
}
