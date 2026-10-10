import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  computeEfforts,
  effectiveIncluded,
  localShare,
  mutateItems,
  seedItems,
} from '../src/domain';
import type { Item } from '../src/types';

describe('allocation among filtered siblings', () => {
  it.each([
    [30, 30, 40, false, false, false],
    [3, 3, 4, false, false, false],
    [0, 0, 40, true, true, false],
    [20, 0, 0, false, true, true],
    [60, 60, 80, false, false, false],
  ])('preserves the subset budget and hidden shares (%s/%s/%s)', (a, b, c, autoA, autoB, autoC) => {
    const items = [item('a', null, {weight: Number(a), allocationAuto: Boolean(autoA)}),
      item('b', null, {weight: Number(b), allocationAuto: Boolean(autoB)}),
      item('c', null, {weight: Number(c), allocationAuto: Boolean(autoC)}),
      item('child', 'a', {weight: 7}), item('excluded', null, {included: false, weight: 19})];
    const budget = localShare(items, 'a') + localShare(items, 'b');
    const result = mutateItems(items, {type: 'allocate', id: 'a', share: 200 / 3, siblingIds: ['a', 'b']});
    expect(localShare(result, 'a')).toBeCloseTo(budget * 2 / 3);
    expect(localShare(result, 'b')).toBeCloseTo(budget / 3);
    expect(localShare(result, 'c')).toBeCloseTo(localShare(items, 'c'));
    expect(result.find(value => value.id === 'c')!.allocationAuto).toBe(Boolean(autoC));
    expect(result.slice(3)).toEqual(items.slice(3));
    expect(items[0]!.weight).toBe(Number(a));
  });

  it('handles zero-share siblings and rejects malformed or empty-budget subsets', () => {
    const items = [item('a', null, {weight: 60}), item('b', null, {weight: 0}), item('c', null, {weight: 40}), item('child', 'a'), item('excluded', null, {included: false})];
    const result = mutateItems(items, {type: 'allocate', id: 'a', share: 50, siblingIds: ['a', 'b']});
    expect(['a', 'b', 'c'].map(id => localShare(result, id))).toEqual([30, 30, 40]);
    for (const siblingIds of [[], ['a'], ['b', 'c'], ['a', 'a'], ['a', 'missing'], ['a', 'child'], ['a', 'excluded']]) {
      expect(() => mutateItems(items, {type: 'allocate', id: 'a', share: 50, siblingIds})).toThrow();
    }
    expect(() => mutateItems(items, {type: 'allocate', id: 'a', share: null, siblingIds: ['a', 'b']})).toThrow(/numeric/);
    expect(() => mutateItems([item('a', null, {weight: 0}), item('b', null, {weight: 0}), item('c', null)],
      {type: 'allocate', id: 'a', share: 50, siblingIds: ['a', 'b']})).toThrow(/no share/);
  });
});

function item(id: string, parentId: string | null, patch: Partial<Item> = {}): Item {
  return {
    id,
    parentId,
    order: 0,
    title: id,
    status: 'Later',
    notes: '',
    included: true,
    weight: 1,
    effortOverride: null,
    ...patch,
  };
}

describe('hierarchy reads', () => {
  it('returns sorted direct children and seeds only the four Topics', () => {
    const items = [
      item('root', null),
      item('later', 'root', { order: 2 }),
      item('first', 'root', { order: 0 }),
      item('nested', 'first'),
    ];
    expect(childrenOf(items, 'root').map(({ id }) => id)).toEqual(['first', 'later']);
    expect(seedItems().map(({ id, title }) => [id, title])).toEqual([
      ['tend', 'Tend'], ['build', 'Build'], ['learn', 'Learn'], ['enjoy', 'Enjoy'],
    ]);
    expect(seedItems().every((seed) => seed.parentId === null)).toBe(true);
  });

  it('keeps descendant selection while an excluded ancestor suppresses visibility', () => {
    const items = [
      item('root', null, { included: false }),
      item('child', 'root', { included: true }),
    ];
    expect(effectiveIncluded(items, 'root')).toBe(false);
    expect(effectiveIncluded(items, 'child')).toBe(false);

    const restored = mutateItems(items, { type: 'update', id: 'root', patch: { included: true } });
    expect(effectiveIncluded(restored, 'child')).toBe(true);
    expect(restored.find(({ id }) => id === 'child')?.included).toBe(true);
  });

  it('normalizes raw sibling weights and evenly shares all-zero siblings', () => {
    const weighted = [item('a', null, { weight: 1 }), item('b', null, { weight: 3 })];
    expect(localShare(weighted, 'a')).toBe(25);
    expect(localShare(weighted, 'b')).toBe(75);

    const zero = [item('a', null, { weight: 0 }), item('b', null, { weight: 0 })];
    expect(localShare(zero, 'a')).toBe(50);
    expect(localShare([...zero, item('hidden', null, { included: false })], 'hidden')).toBe(0);
  });
});

describe('effort', () => {
  it('weights included children upward while Skip and Cut earn no default credit', () => {
    const items = [
      item('parent', null),
      item('done', 'parent', { status: 'Done', weight: 2 }),
      item('skip', 'parent', { status: 'Skip', weight: 1 }),
      item('cut', 'parent', { status: 'Cut', weight: 1 }),
      item('hidden-done', 'parent', { status: 'Done', included: false, weight: 100 }),
    ];
    const efforts = computeEfforts(items);
    expect(efforts.parent).toBe(50);
    expect(efforts.done).toBe(100);
    expect(efforts.skip).toBe(0);
    expect(efforts.cut).toBe(0);
  });

  it('uses even aggregation for zero weights and lets overrides replace branch calculations', () => {
    const items = [
      item('root', null),
      item('branch', 'root', { effortOverride: 240 }),
      item('done', 'branch', { status: 'Done' }),
      item('other', 'root', { effortOverride: 40 }),
    ].map((value) => ({ ...value, weight: value.id === 'root' ? 1 : 0 }));
    const efforts = computeEfforts(items);
    expect(efforts.branch).toBe(240);
    expect(efforts.done).toBe(100);
    expect(efforts.root).toBe(140);
    expect(efforts.branch).toBeGreaterThan(190);
  });

  it('calculates a locally included branch even beneath an excluded ancestor', () => {
    const items = [
      item('hidden', null, { included: false }),
      item('branch', 'hidden'),
      item('done', 'branch', { status: 'Done' }),
    ];
    expect(effectiveIncluded(items, 'done')).toBe(false);
    expect(computeEfforts(items)).toMatchObject({ hidden: 100, branch: 100, done: 100 });
  });
});

describe('mutations', () => {
  it('creates, moves, and exactly reorders siblings without mutating the input', () => {
    const original = [item('root', null), item('a', 'root'), item('b', 'root', { order: 1 })];
    const snapshot = structuredClone(original);
    const created = mutateItems(original, {
      type: 'create', id: 'c', parentId: 'root', title: 'C', patch: { status: 'Now' },
    });
    expect(original).toEqual(snapshot);
    expect(created.at(-1)).toMatchObject({ id: 'c', order: 2, status: 'Now' });

    const reordered = mutateItems(created, {
      type: 'reorder', parentId: 'root', ids: ['c', 'b', 'a'],
    });
    expect(childrenOf(reordered, 'root').map(({ id }) => id)).toEqual(['c', 'b', 'a']);
    const moved = mutateItems(reordered, { type: 'move', id: 'a', parentId: 'b' });
    expect(moved.find(({ id }) => id === 'a')).toMatchObject({ parentId: 'b', order: 0 });
    expect(reordered.find(({ id }) => id === 'a')?.parentId).toBe('root');
  });

  it('allocates exact extremes without changing inclusion, descendants, or hidden siblings', () => {
    const items = [
      item('a', null, { weight: 2 }),
      item('a-child', 'a', { weight: 7 }),
      item('b', null, { weight: 3 }),
      item('hidden', null, { included: false, weight: 11 }),
    ];
    const allToA = mutateItems(items, { type: 'allocate', id: 'a', share: 100 });
    expect(localShare(allToA, 'a')).toBe(100);
    expect(localShare(allToA, 'b')).toBe(0);
    expect(allToA.find(({ id }) => id === 'b')?.included).toBe(true);
    expect(allToA.find(({ id }) => id === 'hidden')?.weight).toBe(11);
    expect(allToA.find(({ id }) => id === 'a-child')?.weight).toBe(7);

    const noneToA = mutateItems(items, { type: 'allocate', id: 'a', share: 0 });
    expect(localShare(noneToA, 'a')).toBe(0);
    expect(localShare(noneToA, 'b')).toBe(100);
    expect(noneToA.find(({ id }) => id === 'a')?.included).toBe(true);
  });

  it('preserves other proportions during allocation', () => {
    const items = [
      item('a', null, { weight: 7 }),
      item('b', null, { weight: 1 }),
      item('c', null, { weight: 3 }),
    ];
    const allocated = mutateItems(items, { type: 'allocate', id: 'a', share: 20 });
    expect(localShare(allocated, 'a')).toBeCloseTo(20);
    expect(localShare(allocated, 'b')).toBeCloseTo(20);
    expect(localShare(allocated, 'c')).toBeCloseTo(60);
  });

  it('gives visible skipped or cut branches no automatic credit without rewriting their children', () => {
    const items = [item('root', null), item('cut', 'root', { status: 'Cut' }), item('done', 'cut', { status: 'Done' }), item('peer', 'root', { status: 'Done' })];
    expect(computeEfforts(items)).toMatchObject({ root: 50, cut: 0, done: 100, peer: 100 });
    expect(items.find(value => value.id === 'done')?.status).toBe('Done');
    const assessed = mutateItems(items, { type: 'update', id: 'cut', patch: { effortOverride: 150 } });
    expect(computeEfforts(assessed)).toMatchObject({ root: 125, cut: 150, done: 100 });
  });

  it('bulk-updates selected Items immutably and leaves status independent across levels', () => {
    const items = [item('parent', null), item('a', 'parent'), item('b', 'parent')];
    const updated = mutateItems(items, {
      type: 'bulk', ids: ['a', 'b'], patch: { status: 'Done', effortOverride: 215 },
    });
    expect(updated.find(({ id }) => id === 'parent')?.status).toBe('Later');
    expect(updated.filter(({ parentId }) => parentId === 'parent'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'a', status: 'Done', effortOverride: 215 }),
        expect.objectContaining({ id: 'b', status: 'Done', effortOverride: 215 }),
      ]));
    expect(items[1]).toMatchObject({ status: 'Later', effortOverride: null });
  });

  it.each([
    ['duplicate ids', [item('x', null), item('x', null)],
      { type: 'update', id: 'x', patch: { title: 'new' } }],
    ['missing parent', [item('x', 'missing')],
      { type: 'update', id: 'x', patch: { title: 'new' } }],
    ['negative weight', [item('x', null)],
      { type: 'update', id: 'x', patch: { weight: -1 } }],
    ['infinite effort', [item('x', null)],
      { type: 'update', id: 'x', patch: { effortOverride: Infinity } }],
    ['blank title', [item('x', null)],
      { type: 'update', id: 'x', patch: { title: '  ' } }],
  ] as const)('rejects %s', (_label, items, command) => {
    expect(() => mutateItems(items, command as never)).toThrow();
  });

  it('rejects cycles, invalid allocation, and incomplete reorder commands', () => {
    const items = [item('root', null), item('child', 'root'), item('peer', 'root')];
    expect(() => mutateItems(items, { type: 'move', id: 'root', parentId: 'child' }))
      .toThrow(/cycle/);
    expect(() => mutateItems(items, { type: 'allocate', id: 'child', share: 101 }))
      .toThrow(/percentage/);
    expect(() => mutateItems(items, { type: 'reorder', parentId: 'root', ids: ['child'] }))
      .toThrow(/every sibling/);
    expect(() => mutateItems(items, {
      type: 'reorder', parentId: 'root', ids: ['child', 'child'],
    })).toThrow(/duplicate/);
  });
});

describe('standalone Item operations', () => {
  it('includes dynamically created Items independently of status and ancestor visibility', () => {
    const original = [item('root', null, { included: false })];
    for (const status of ['Later', 'Done', 'Skip', 'Cut'] as const) {
      const created = mutateItems(original, { type: 'create', id: status, parentId: 'root', title: status, patch: { status } });
      expect(created.at(-1)).toMatchObject({ status, included: true });
      expect(effectiveIncluded(created, status)).toBe(false);
    }
    const excluded = mutateItems(original, { type: 'create', parentId: 'root', title: 'Explicitly hidden', patch: { included: false } });
    expect(excluded.at(-1)?.included).toBe(false);
  });

  it('removes an entire subtree without changing unrelated Items or the source array', () => {
    const original = [item('root', null), item('child', 'root'), item('grandchild', 'child'), item('peer', null)];
    const deleted = mutateItems(original, { type: 'delete', id: 'root' });
    expect(deleted).toEqual([original[3]]);
    expect(original).toHaveLength(4);
    expect(() => mutateItems(original, { type: 'delete', id: 'unknown' })).toThrow(/Unknown item/);
  });

  it('atomically deletes multiple subtrees, tolerates overlapping roots and rejects unknown IDs', () => {
    const original = [item('root', null), item('child', 'root'), item('grandchild', 'child'), item('peer', null), item('keep', null)];
    expect(mutateItems(original, { type: 'delete-many', ids: ['root', 'child', 'peer'] })).toEqual([original[4]]);
    expect(() => mutateItems(original, { type: 'delete-many', ids: ['child', 'missing'] })).toThrow(/Unknown item/);
    expect(() => mutateItems(original, { type: 'delete-many', ids: [] })).toThrow(/empty/);
    expect(original.map(value => value.id)).toEqual(['root', 'child', 'grandchild', 'peer', 'keep']);
  });

  it('validates and patches specific default-prompt and file references', () => {
    const original = [item('root', null)];
    const updated = mutateItems(original, { type: 'update', id: 'root', patch: { defaultPromptId: 'launch-game', resourceUri: 'file:///media/game' } });
    expect(updated[0]).toMatchObject({ defaultPromptId: 'launch-game', resourceUri: 'file:///media/game' });
    expect(() => mutateItems(original, { type: 'update', id: 'root', patch: { defaultPromptId: '' } })).toThrow();
    expect(() => mutateItems(original, { type: 'update', id: 'root', patch: { resourceUri: '\0' } })).toThrow();
    expect(mutateItems(updated, { type: 'update', id: 'root', patch: { defaultPromptId: null, resourceUri: null } })[0]).toMatchObject({ defaultPromptId: null, resourceUri: null });
  });
});

describe('automatic allocations', () => {
  const shares = (items: Item[]) => items.filter(item => item.parentId === null).map(item => localShare(items, item.id));
  const clear = (items: Item[], id: string) => mutateItems(items, { type: 'allocate', id, share: null });

  it('splits the remainder and keeps explicit siblings fixed as that remainder changes', () => {
    const original = [item('a', null, { weight: 4 }), item('b', null, { weight: 3 }), item('c', null, { weight: 3 }), item('nested', 'a', { weight: 17 })];
    let items = clear(clear(original, 'b'), 'c');
    expect(shares(items)).toEqual([40, 30, 30]);
    items = mutateItems(items, { type: 'allocate', id: 'a', share: 60 });
    expect(shares(items)).toEqual([60, 20, 20]);
    expect(items[3]).toEqual(original[3]);
    expect(original[1]?.allocationAuto).toBeUndefined();
    items = mutateItems(items, { type: 'allocate', id: 'b', share: 25 });
    expect(shares(items)).toEqual([60, 25, 15]);
    expect(items[1]?.allocationAuto).toBe(false);
    expect(() => mutateItems(items, { type: 'allocate', id: 'a', share: 80 })).toThrow(/remains/);
    expect(shares(mutateItems(items, { type: 'allocate', id: 'a', share: 75 }))).toEqual([75, 25, 0]);
  });

  it('materializes existing proportions on first clear, including hidden sibling ratios', () => {
    const items = clear([item('a', null, { weight: 1 }), item('b', null, { weight: 3 }), item('c', null, { weight: 6 }), item('hidden', null, { weight: 2, included: false })], 'b');
    expect(shares(items)).toEqual([10, 30, 60, 0]);
    expect(items[3]?.weight).toBe(20);
    expect(clear(items, 'b')).toEqual(items);
    expect(shares(clear(clear(items, 'a'), 'c')).slice(0, 3)).toEqual([100 / 3, 100 / 3, 100 / 3]);
  });

  it('excludes hidden blanks and redistributes the remaining effort weight', () => {
    let items = [item('root', null), item('a', 'root', { weight: 40, status: 'Done' }), item('b', 'root', { allocationAuto: true, weight: 999, effortOverride: 150 }), item('c', 'root', { allocationAuto: true, weight: 1 })];
    expect(computeEfforts(items).root).toBe(85);
    items = mutateItems(items, { type: 'update', id: 'c', patch: { included: false } });
    expect(localShare(items, 'b')).toBe(60);
    expect(computeEfforts(items).root).toBe(130);
    items = mutateItems(items, { type: 'update', id: 'c', patch: { included: true } });
    expect(localShare(items, 'b')).toBe(30);
    expect(computeEfforts(items).root).toBe(85);
  });

  it('keeps legacy proportional resizing when the last blank becomes explicit', () => {
    const items = [item('a', null, { weight: 40 }), item('b', null, { weight: 60, allocationAuto: true })];
    const manual = mutateItems(items, { type: 'allocate', id: 'b', share: 20 });
    expect(shares(manual)).toEqual([80, 20]);
    expect(manual[1]?.allocationAuto).toBe(false);
    expect(shares(clear([item('only', null)], 'only'))).toEqual([100]);
  });

  it('fits explicit shares when re-inclusion overfills a mixed group', () => {
    const items = [item('a', null, { weight: 60 }), item('b', null, { allocationAuto: true }), item('hidden', null, { weight: 60, included: false })];
    const included = mutateItems(items, { type: 'update', id: 'hidden', patch: { included: true } });
    expect(shares(included)).toEqual([50, 0, 50]);
    const hiddenAgain = mutateItems(included, { type: 'update', id: 'hidden', patch: { included: false } });
    expect(shares(hiddenAgain)).toEqual([50, 50, 0]);
  });
});

it('defaults new Items to automatic allocation but honors explicit creation overrides', () => {
  const original = [item('root', null), item('a', 'root', { allocationAuto: true })];
  const auto = mutateItems(original, { type: 'create', id: 'b', parentId: 'root', title: 'B' });
  expect(auto.find(item => item.id === 'b')?.allocationAuto).toBe(true);
  expect(localShare(auto, 'b')).toBe(50);
  const explicit = mutateItems(original, { type: 'create', id: 'b', parentId: 'root', title: 'B', share: 30, patch: { status: 'Doing', effortOverride: 125 } });
  expect(localShare(explicit, 'b')).toBe(30);
  expect(explicit.find(item => item.id === 'b')).toMatchObject({ allocationAuto: false, status: 'Doing', effortOverride: 125 });
  expect(seedItems().every(item => item.allocationAuto)).toBe(true);
  const weighted = mutateItems(original, { type: 'create', id: 'b', parentId: 'root', title: 'B', patch: { weight: 20 } });
  expect(weighted.find(item => item.id === 'b')?.allocationAuto).toBe(false);
});

it('can clear a hidden allocation without including the Item or editing its descendants', () => {
  const original = [item('root', null), item('hidden', 'root', { included: false, weight: 2 }), item('visible', 'root', { weight: 2 })];
  const cleared = mutateItems(original, { type: 'allocate', id: 'hidden', share: null });
  expect(cleared[1]).toMatchObject({ included: false, allocationAuto: true });
  expect(localShare(cleared, 'visible')).toBe(100);
  expect(cleared[0]).toEqual(original[0]);
});

describe('outline arrangement', () => {
  it('moves selected roots atomically, preserves descendants, and orders relative to all destination siblings', () => {
    const items = [item('a', null), item('b', null), item('project', 'a'), item('child', 'project'), item('hidden', 'b', { included: false }), item('last', 'b', { order: 1 })];
    const result = mutateItems(items, { type: 'arrange', ids: ['project', 'child'], parentId: 'b', beforeId: 'last' });
    expect(childrenOf(result, 'b').map(item => item.id)).toEqual(['hidden', 'project', 'last']);
    expect(result.find(item => item.id === 'child')?.parentId).toBe('project');
    expect(items.find(item => item.id === 'project')?.parentId).toBe('a');
    expect(() => mutateItems(items, { type: 'arrange', ids: ['project'], parentId: 'child' })).toThrow(/descendants/);
    expect(() => mutateItems(items, { type: 'arrange', ids: ['project', 'missing'], parentId: 'b' })).toThrow();
    expect(() => mutateItems(items, { type: 'arrange', ids: ['project'], parentId: 'b', beforeId: 'a' })).toThrow(/destination sibling/);
    expect(() => mutateItems(items, { type: 'arrange', ids: ['project', 'project'], parentId: 'b' })).toThrow(/duplicate/);
  });

  it('restores normalized sibling allocations exactly without overwriting subsequent notes or statuses', () => {
    const before = [item('a', null), item('b', null), item('project', 'a', { weight: 70 }), item('existing', 'b', { weight: 80 }), item('auto', 'b', { allocationAuto: true })];
    const moved = mutateItems(before, { type: 'arrange', ids: ['project'], parentId: 'b' });
    expect(moved.find(item => item.id === 'existing')?.weight).toBeCloseTo(80 * 100 / 150);
    const placements = (items: Item[]) => items.map(({ id, parentId, order, weight, allocationAuto }) => ({ id, parentId, order, weight, allocationAuto }));
    const command = { type: 'restore-arrangement' as const, placements: placements(before), expected: moved.map(item => ({ ...placements([item])[0]!, included: item.included })) };
    const edited = mutateItems(moved, { type: 'update', id: 'project', patch: { notes: 'Keep this new note', status: 'Doing' } });
    const restored = mutateItems(edited, command);
    expect(placements(restored)).toEqual(placements(before));
    expect(restored.find(item => item.id === 'project')).toMatchObject({ notes: 'Keep this new note', status: 'Doing' });
    expect(() => mutateItems(mutateItems(moved, { type: 'update', id: 'auto', patch: { included: false } }), command)).toThrow(/no longer be undone/);
    expect(() => mutateItems(mutateItems(moved, { type: 'create', parentId: 'b', title: 'New child' }), command)).toThrow(/no longer be undone/);
    expect(() => mutateItems(moved, { ...command, placements: command.placements.map(item => item.id === 'a' ? { ...item, parentId: 'project' } : item) })).toThrow();
  });
});
