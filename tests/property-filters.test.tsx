// @vitest-environment jsdom
import React, {useState} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import type {Item, WorkspaceSettings} from '../src/types';
import {DEFAULT_WORKSPACE_SETTINGS} from '../src/properties';
import {computeEfforts} from '../src/domain';
import {activePropertyFilters, matchingItemIds, parsePropertyFilters, readPropertyFilters, savePropertyFilters, type PropertyFilters} from '../ui/property-filters';
import {FilterControl} from '../ui/FilterControl';
import {buildSunburstLayout} from '../ui/Sunburst';
import {buildKanbanModel} from '../ui/kanban-helpers';
import {outlineModel} from '../ui/outline-model';
import {initialRoute, parseRoute, routeUrl} from '../ui/navigation';

const settings: WorkspaceSettings = {...DEFAULT_WORKSPACE_SETTINGS, properties: [...DEFAULT_WORKSPACE_SETTINGS.properties, {
  id: 'project', name: 'Project', unsetLabel: 'No project', unsetColor: '#aaa', defaultValue: null,
  options: [{id: 'a', label: 'Project A', color: '#123456'}, {id: 'b', label: 'Project B', color: '#654321'}],
}]};
const item = (id: string, parentId: string | null, extra: Partial<Item> = {}): Item => ({id, parentId, title: id, status: 'Later', properties: {}, notes: '', order: 0, included: true, weight: 1, effortOverride: null, ...extra});
const items = [item('root', null, {status: 'Done'}), item('ready', 'root', {status: 'Now', properties: {project: 'a'}}),
  item('finished', 'root', {status: 'Done', properties: {project: 'b'}, weight: 3}),
  item('unset', null, {status: null}), item('hidden', null, {included: false, order: 2}), item('hidden-child', 'hidden', {status: 'Now'})];
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it.each([false, true])('restores saved filters only on startup, respecting explicit URL filters (demo=%s)', demo => {
  savePropertyFilters({status: ['Done'], project: [null, 'b']});
  const url = (filters?: PropertyFilters) => new URL(routeUrl({itemId: null, focusId: null, filters}, demo), 'https://example.com');
  expect(initialRoute(url(), demo).filters).toEqual({status: ['Done'], project: [null, 'b']});
  expect(parseRoute(url(), demo).filters).toBeUndefined();
  expect(initialRoute(url({status: ['Cut']}), demo).filters).toEqual({status: ['Cut']});
  expect(initialRoute(url({}), demo).filters).toEqual({});
});

it('tolerates corrupt or unavailable local storage', () => {
  localStorage.setItem('life-manager.property-filters', 'not json');
  expect(readPropertyFilters()).toEqual({});
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  expect(readPropertyFilters()).toEqual({});
  expect(() => savePropertyFilters({status: ['Done']})).not.toThrow();
});

it('combines excluded values across properties, treating null Status as its default', () => {
  expect(matchingItemIds(items, {})).toBeUndefined();
  expect([...matchingItemIds(items, {status: ['Done', 'Later', null]})!]).toEqual(['ready', 'hidden-child']);
  expect([...matchingItemIds(items, {status: ['Done', 'Later', null], project: [null, 'b']})!]).toEqual(['ready']);
  expect([...matchingItemIds(items, {status: ['Now', 'Done', null]})!]).toEqual(['unset', 'hidden']);
  expect([...matchingItemIds(items, {status: ['Later']}, settings)!]).toEqual(['root', 'ready', 'finished', 'hidden-child']);
  expect([...matchingItemIds(items, {project: [null, 'a', 'b']})!]).toEqual([]);
});

it('ignores removed properties and option IDs while keeping explicit None filters', () => {
  expect(activePropertyFilters({missing: ['x'], project: ['deleted'], status: ['Done', 'Done']}, settings)).toEqual({status: ['Done']});
  expect(activePropertyFilters({status: [null]}, settings)).toEqual({status: ['Later']});
  expect(activePropertyFilters({project: [null, 'a', 'b']}, settings)).toEqual({project: [null, 'a', 'b']});
  expect(activePropertyFilters({project: [null, 'a', 'b']}, {...settings, properties: []})).toEqual({});
});

it.each([false, true])('preserves filters in URLs, including empty/unset values (demo=%s)', demo => {
  const route = {itemId: 'ready', focusId: 'root', view: 'outline' as const, filters: {status: ['Done', null], project: ['b']}};
  expect(parseRoute(new URL(routeUrl(route, demo), 'https://example.com'), demo)).toEqual(route);
  expect(parsePropertyFilters('not json')).toEqual({});
  expect(parsePropertyFilters('["status"]')).toEqual({});
  expect(parsePropertyFilters('{"status":false,"project":["a",null]}')).toEqual({project: ['a', null]});
});

it('filters board cards after leaf eligibility, preserving shares and parent paths', () => {
  const original = buildKanbanModel(items, null, 'Order', settings);
  const filtered = buildKanbanModel(items, null, 'Order', settings, 'status', new Set(['ready']));
  expect(filtered.cards.map(card => card.item.id)).toEqual(['ready']);
  expect(filtered.cards[0]!.share).toBe(original.cards.find(card => card.item.id === 'ready')!.share);
  expect(filtered.cards[0]!.parentPath.map(item => item.id)).toEqual(['root']);
  expect(filtered.columns.map(column => column.label)).toEqual(['Now']);
  expect(buildKanbanModel(items, null, 'Order', settings, 'status', new Set(['root'])).cards).toEqual([]);
});

it('keeps wheel ancestor paths but excludes unmatched siblings and hidden branches', () => {
  const efforts = computeEfforts(items, settings);
  const options = {focusId: null, showAll: false, efforts, matchingIds: new Set(['ready', 'hidden-child'])};
  const layout = buildSunburstLayout(items, options);
  expect(layout.map(segment => segment.id)).toEqual(['root', 'ready']);
  expect(layout.find(segment => segment.id === 'ready')).toMatchObject({actualShare: 25, displayShare: 100});
  expect(layout.find(segment => segment.id === 'root')!.effort).toBe(efforts.root);
  expect(buildSunburstLayout(items, {...options, showAll: true}).map(segment => segment.id)).toEqual(['root', 'hidden', 'ready', 'hidden-child']);
  expect(buildSunburstLayout(items, {...options, matchingIds: new Set()})).toEqual([]);
});

it('reveals Outline matches through collapsed ancestors and combines with its own search and inclusion switch', () => {
  const matching = new Set(['ready', 'hidden-child']);
  const all = outlineModel(items, new Set(), true, '', settings, 'Order', 'status', matching);
  expect(all.rows.map(row => [row.item.id, row.contextOnly])).toEqual([
    ['root', true], ['ready', false], ['hidden', true], ['hidden-child', false],
  ]);
  expect(all.rows.every(row => row.open)).toBe(true);
  expect(outlineModel(items, new Set(), false, '', settings, 'Order', 'status', matching).rows.map(row => row.item.id)).toEqual(['root', 'ready']);
  expect(outlineModel(items, new Set(), true, 'ready', settings, 'Order', 'status', matching).rows.map(row => row.item.id)).toEqual(['root', 'ready']);
  expect(outlineModel(items, new Set(), true, 'finished', settings, 'Order', 'status', matching).rows).toEqual([]);
  expect(outlineModel(items, new Set(), true, '', settings, 'Order').rows.every(row => row.depth === 0)).toBe(true);
});

it('applies chip toggles, All/None and Reset immediately without closing the popup', () => {
  function Harness() {
    const [filters, setFilters] = useState<PropertyFilters>({});
    return <><FilterControl settings={settings} filters={filters} onChange={setFilters} /><output>{JSON.stringify(filters)}</output></>;
  }
  render(<Harness />);
  const trigger = screen.getByRole('button', {name: 'Filters'});
  fireEvent.click(trigger);
  const status = within(screen.getByRole('group', {name: 'Status'}));
  const project = within(screen.getByRole('group', {name: 'Project'}));
  fireEvent.click(status.getByRole('button', {name: 'Done'}));
  expect(status.getByRole('button', {name: 'Done'}).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('status').textContent).toBe('{"status":["Done"]}');
  fireEvent.click(project.getByRole('button', {name: 'Hide all Project values'}));
  fireEvent.click(project.getByRole('button', {name: 'Project A'}));
  expect(screen.getByRole('status').textContent).toBe('{"status":["Done"],"project":[null,"b"]}');
  fireEvent.click(status.getByRole('button', {name: 'Show all Status values'}));
  expect(screen.getByRole('status').textContent).toBe('{"project":[null,"b"]}');
  fireEvent.click(screen.getByRole('button', {name: 'Reset all'}));
  expect(screen.getByRole('status').textContent).toBe('{}');
  expect(screen.getByRole('dialog', {name: 'Filter Items'})).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
