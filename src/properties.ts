import type { EnumOption, EnumProperty, Item, Workspace, WorkspaceSettings } from './types';

const defaults: WorkspaceSettings = {
  name: 'Life',
  lifecyclePropertyId: 'status',
  properties: [{
    id: 'status', name: 'Status', unsetLabel: 'Unset', unsetColor: '#b4b8ae', defaultValue: 'Later',
    options: [
      { id: 'Now', label: 'Now', color: '#c88d51' },
      { id: 'Doing', label: 'Doing', color: '#658baa' },
      { id: 'Blocked', label: 'Blocked', color: '#c78369' },
      { id: 'Done', label: 'Done', color: '#719477', behavior: 'complete' },
      { id: 'Later', label: 'Later', color: '#7b8178' },
      { id: 'Skip', label: 'Skip', color: '#a9a48f', behavior: 'skip' },
      { id: 'Cut', label: 'Cut', color: '#a2929b', behavior: 'skip' },
    ],
  }],
};
for (const property of defaults.properties) {
  property.options.forEach(Object.freeze);
  Object.freeze(property.options);
  Object.freeze(property);
}
Object.freeze(defaults.properties);
/** Immutable template; clone before editing configuration. */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = Object.freeze(defaults);
export function workspaceSettings(workspace?: Pick<Workspace, 'settings'>): WorkspaceSettings {
  return workspace?.settings ?? DEFAULT_WORKSPACE_SETTINGS;
}
export function propertyValue(item: Item, propertyId: string): string | null {
  return propertyId === 'status' ? item.status ?? null : item.properties?.[propertyId] ?? null;
}
export type PropertyHierarchy = readonly Item[] | Pick<ReadonlyMap<string, Item>, 'get'>;
export interface ResolvedProperty { value: string | null; inherited: boolean; source: Item | null }

/** Snapshot definitions without inheritance keep their original null semantics. */
export function resolvePropertyValue(item: Item, property: EnumProperty, items: PropertyHierarchy = []): ResolvedProperty {
  const value = propertyValue(item, property.id);
  if (!property.inheritFromParent) return {value: property.id === 'status' ? value ?? property.defaultValue : value, inherited: false, source: item};
  if (value !== null) return {value, inherited: false, source: item};
  const seen = new Set([item.id]);
  let parentId = item.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = 'get' in items ? items.get(parentId) : items.find(candidate => candidate.id === parentId);
    if (!parent) break;
    const inherited = propertyValue(parent, property.id);
    if (inherited !== null) return {value: inherited, inherited: true, source: parent};
    parentId = parent.parentId;
  }
  return {value: property.fallbackValue ?? null, inherited: true, source: null};
}
export function effectivePropertyValue(item: Item, property: EnumProperty, items: PropertyHierarchy = []): string | null {
  return resolvePropertyValue(item, property, items).value;
}
export function propertyOption(property: EnumProperty, value: string | null): EnumOption | undefined {
  return property.options.find(option => option.id === value);
}
export function lifecycleBehavior(item: Item, settings: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS, items: PropertyHierarchy = []): 'normal' | 'complete' | 'skip' {
  const property = settings.properties.find(property => property.id === settings.lifecyclePropertyId);
  return property ? propertyOption(property, effectivePropertyValue(item, property, items))?.behavior ?? 'normal' : 'normal';
}
export function defaultPropertyValues(settings: WorkspaceSettings): Pick<Item, 'status' | 'properties'> {
  return {
    status: settings.properties.find(property => property.id === 'status')?.defaultValue ?? null,
    properties: Object.fromEntries(settings.properties.filter(property => property.id !== 'status').map(property => [property.id, property.defaultValue])),
  };
}
function text(value: unknown, label: string, max = 200): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${label} is invalid`);
}
function safeId(value: unknown, label: string): asserts value is string {
  text(value, label);
  if (['__proto__', 'prototype', 'constructor'].includes(value)) throw new Error(`${label} is reserved`);
}
export function validateSettings(settings: WorkspaceSettings): void {
  if (!settings || typeof settings !== 'object') throw new Error('Workspace settings are invalid');
  text(settings.name, 'Workspace name', 500);
  if (!Array.isArray(settings.properties) || settings.properties.length > 100) throw new Error('Properties are invalid');
  const ids = new Set<string>();
  for (const property of settings.properties) {
    if (!property || typeof property !== 'object') throw new Error('Property is invalid');
    safeId(property.id, 'Property id');
    if (ids.has(property.id)) throw new Error(`Duplicate property id: ${property.id}`);
    ids.add(property.id);
    text(property.name, 'Property name', 500);
    text(property.unsetLabel, 'Unset label', 500);
    if (property.unsetShowByDefault !== undefined && typeof property.unsetShowByDefault !== 'boolean') throw new Error('Unset default visibility must be a boolean');
    if (!/^#[0-9a-f]{6}$/i.test(property.unsetColor)) throw new Error('Unset color must be a six-digit hex color');
    if (!Array.isArray(property.options) || property.options.length > 500) throw new Error('Property options are invalid');
    const values = new Set<string>();
    for (const option of property.options) {
      if (!option || typeof option !== 'object') throw new Error('Option is invalid');
      safeId(option.id, 'Option id');
      if (values.has(option.id)) throw new Error(`Duplicate option id: ${option.id}`);
      values.add(option.id);
      text(option.label, 'Option label', 500);
      if (option.showByDefault !== undefined && typeof option.showByDefault !== 'boolean') throw new Error('Option default visibility must be a boolean');
      if (!/^#[0-9a-f]{6}$/i.test(option.color)) throw new Error('Option color must be a six-digit hex color');
      if (option.behavior !== undefined && !['normal', 'complete', 'skip'].includes(option.behavior)) throw new Error('Option behavior is invalid');
    }
    if (property.defaultValue !== null && !values.has(property.defaultValue)) throw new Error(`Default value is invalid for ${property.id}`);
    if (property.inheritFromParent !== undefined && typeof property.inheritFromParent !== 'boolean') throw new Error('Property inheritance must be a boolean');
    if (property.fallbackValue !== undefined && !values.has(property.fallbackValue)) throw new Error(`Workspace default is invalid for ${property.id}`);
    if (property.inheritFromParent && !property.fallbackValue) throw new Error(`Choose a workspace default for ${property.name}`);
  }
  if (settings.lifecyclePropertyId !== null && !ids.has(settings.lifecyclePropertyId)) throw new Error('Lifecycle property is invalid');
}
export function validatePropertyValue(settings: WorkspaceSettings, id: string, value: unknown): void {
  const property = settings.properties.find(property => property.id === id);
  if (!property) {
    if (id === 'status' && value === null) return;
    throw new Error(`Unknown property: ${id}`);
  }
  if (value !== null && (typeof value !== 'string' || !property.options.some(option => option.id === value))) throw new Error(`Value for ${id} is invalid`);
}
