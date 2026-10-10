import { describe, expect, it } from 'vitest';
import { computeEfforts, mutateItems } from '../src/domain';
import { DEFAULT_WORKSPACE_SETTINGS, effectivePropertyValue, resolvePropertyValue } from '../src/properties';
import type { EnumProperty, Item, WorkspaceSettings } from '../src/types';
import { activePropertyFilters, matchingItemIds } from '../ui/property-filters';
import { propertyPresentation } from '../ui/property-presentation';
import { buildKanbanModel } from '../ui/kanban-helpers';
import { viewComparator } from '../ui/view-sort';

const priority: EnumProperty = {id: 'priority', name: 'Priority', unsetLabel: 'Unset', unsetColor: '#aaaaaa',
  inheritFromParent: true, defaultValue: null, fallbackValue: 'low', options: [
    {id: 'high', label: 'High', color: '#ff0000', showByDefault: false, behavior: 'complete'},
    {id: 'low', label: 'Low', color: '#00ff00'},
  ]};
const settings: WorkspaceSettings = {...DEFAULT_WORKSPACE_SETTINGS, properties: [...DEFAULT_WORKSPACE_SETTINGS.properties, priority]};
function item(id: string, parentId: string | null, value: string | null = null): Item {
  return {id, title: id, parentId, order: 0, included: true, status: 'Later', weight: 1, effortOverride: null, notes: '', properties: {priority: value}};
}

describe('property inheritance', () => {
  it('resolves the nearest explicit ancestor, including excluded ancestors, then the workspace fallback', () => {
    const root = {...item('root', null, 'high'), included: false};
    const child = item('child', 'root');
    const leaf = item('leaf', 'child');
    const items = [root, child, leaf];
    expect(resolvePropertyValue(leaf, priority, items)).toEqual({value: 'high', inherited: true, source: root});
    child.properties!.priority = 'low';
    expect(resolvePropertyValue(leaf, priority, new Map(items.map(item => [item.id, item])))).toEqual({value: 'low', inherited: true, source: child});
    leaf.properties!.priority = 'high';
    expect(resolvePropertyValue(leaf, priority, items)).toEqual({value: 'high', inherited: false, source: leaf});
    expect(resolvePropertyValue(item('orphan', null), priority, items)).toEqual({value: 'low', inherited: true, source: null});
  });

  it('updates effective values after ancestor edits and moves while preserving stored inheritance', () => {
    let items = [item('root', null, 'high'), item('other', null, 'low'), item('child', 'root')];
    items = mutateItems(items, {type: 'update', id: 'root', patch: {properties: {priority: 'low'}}}, settings);
    expect(effectivePropertyValue(items[2]!, priority, items)).toBe('low');
    items = mutateItems(items, {type: 'update', id: 'other', patch: {properties: {priority: 'high'}}}, settings);
    items = mutateItems(items, {type: 'move', id: 'child', parentId: 'other'}, settings);
    expect(effectivePropertyValue(items.find(item => item.id === 'child')!, priority, items)).toBe('high');
    expect(items.find(item => item.id === 'child')!.properties!.priority).toBeNull();
  });

  it('uses resolved values for default visibility, explicit filters, colours, sorting and Kanban groups', () => {
    const items = [item('root', null, 'high'), item('inherited', 'root'), item('explicit', 'root', 'low')];
    expect([...matchingItemIds(items, activePropertyFilters({}, settings), settings)!]).toEqual(['explicit']);
    expect(activePropertyFilters({}, settings, 'priority')).toEqual({});
    expect([...matchingItemIds(items, activePropertyFilters({priority: ['low']}, settings, 'priority'), settings)!]).toEqual(['root', 'inherited']);
    expect(propertyPresentation(items[1]!, priority, items)).toEqual({label: 'High', color: '#ff0000'});
    expect([items[2]!, items[1]!].sort(viewComparator(items, 'Status', settings, 'priority')).map(item => item.id)).toEqual(['inherited', 'explicit']);
    const board = buildKanbanModel(items, 'root', 'Order', settings, 'priority');
    expect(board.columns.map(column => column.status)).toEqual(['high', 'low']);
    expect(board.columns[0]!.groups[0]!.cards[0]!.item.id).toBe('inherited');
  });

  it('applies inherited lifecycle behaviour while retaining explicit creation defaults and manual effort', () => {
    const lifecycle = {...settings, lifecyclePropertyId: 'priority'};
    let items = [item('root', null, 'high')];
    items = mutateItems(items, {type: 'create', id: 'child', parentId: 'root', title: 'Child'}, lifecycle);
    const child = items.find(item => item.id === 'child')!;
    expect(child).toMatchObject({status: 'Later', properties: {priority: null}});
    expect(computeEfforts(items, lifecycle).child).toBe(100);
    child.effortOverride = 140;
    expect(computeEfforts(items, lifecycle).child).toBe(140);
  });
});
