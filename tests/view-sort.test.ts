import { describe, it, expect } from 'vitest';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/properties';
import type { Item, WorkspaceSettings } from '../src/types';
import { computeEfforts } from '../src/domain';
import { viewComparator, type ViewSort } from '../ui/view-sort';
import { buildSunburstLayout } from '../ui/Sunburst';
import { buildKanbanModel } from '../ui/kanban-helpers';

const items: Item[] = [
  {id: 'a', parentId: null, title: 'A', order: 0, status: 'Later', included: true, weight: 50, allocationAuto: false, effortOverride: 50, notes: ''},
  {id: 'b', parentId: null, title: 'B', order: 1, status: 'Now', included: true, weight: 999, allocationAuto: true, effortOverride: 180, notes: ''},
  {id: 'c', parentId: null, title: 'C', order: 2, status: 'Done', included: true, weight: 40, allocationAuto: false, effortOverride: null, notes: ''},
];

describe('temporary dashboard sorting', () => {
  it.each<[ViewSort, string[]]>([
    ['Order', ['a', 'b', 'c']], ['Status', ['b', 'c', 'a']],
    ['Importance', ['a', 'c', 'b']], ['Effort', ['b', 'c', 'a']],
  ])('%s sorts actual allocation/effort and leaves saved order intact', (sort, expected) => {
    const original = structuredClone(items);
    const layout = buildSunburstLayout(items, {focusId: null, showAll: false, efforts: computeEfforts(items), compareItems: viewComparator(items, sort)});
    expect(layout.map(item => item.id)).toEqual(expected);
    expect(buildKanbanModel(items, null, sort).cards.map(card => card.item.id)).toEqual(expected);
    expect(items).toEqual(original);
    expect(buildKanbanModel(items, null, 'Order').cards.map(card => card.item.id)).toEqual(['a', 'b', 'c']);
  });
  it('retains parent groups and saved order among equal values', () => {
    const tree = [...items, ...['a', 'b'].flatMap(parentId => [0, 1].map(order => ({...items[0]!, id: parentId + order, parentId, order, weight: 1, allocationAuto: true, status: 'Now' as const})))];
    const board = buildKanbanModel(tree, null, 'Importance');
    const groups = board.columns.find(column => column.status === 'Now')!.groups;
    expect(groups.map(group => group.cards.map(card => card.item.id))).toEqual([['a0', 'a1'], ['b0', 'b1']]);
  });
});

it('sorts by the selected property option order with unset last and saved order breaking ties', () => {
  const settings: WorkspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS, properties: [...DEFAULT_WORKSPACE_SETTINGS.properties, {
    id: 'category', name: 'Category', unsetLabel: 'Unset', unsetColor: '#aaaaaa', defaultValue: null,
    options: [{ id: 'book', label: 'Reading', color: '#123456' }, { id: 'code', label: 'Making', color: '#654321' }],
  }] };
  const custom = items.map((item, index) => ({ ...item, properties: { category: [null, 'code', 'book'][index]! } }));
  expect([...custom].sort(viewComparator(custom, 'Status', settings, 'category')).map(item => item.id)).toEqual(['c', 'b', 'a']);
  expect(buildKanbanModel(custom, null, 'Status', settings, 'category').cards.map(card => card.item.id)).toEqual(['c', 'b', 'a']);
  expect([...custom].sort(viewComparator(custom, 'Status', settings, null)).map(item => item.id)).toEqual(['a', 'b', 'c']);
});

it('uses the supplied lifecycle configuration for effort sorting', () => {
  const settings = structuredClone(DEFAULT_WORKSPACE_SETTINGS);
  settings.properties[0]!.options.find(option => option.id === 'Now')!.behavior = 'complete';
  settings.properties[0]!.options.find(option => option.id === 'Done')!.behavior = 'normal';
  const automatic = items.map(item => ({ ...item, effortOverride: null }));
  expect([...automatic].sort(viewComparator(automatic, 'Effort', settings)).map(item => item.id)).toEqual(['b', 'a', 'c']);
});
