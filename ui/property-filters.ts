import type { Item, WorkspaceSettings } from '../src/types';
import { DEFAULT_WORKSPACE_SETTINGS, effectivePropertyValue, propertyValue } from '../src/properties';
import { propertyChoices } from './PropertySelect';

/** Explicit hidden-value overrides. Absent properties use configured defaults; [] shows all. */
export type PropertyFilters = Record<string, (string | null)[]>;

const storageKey = 'life-manager.property-filters';

export function readPropertyFilters(): PropertyFilters {
  try { return parsePropertyFilters(localStorage.getItem(storageKey)); } catch { return {}; }
}

export function savePropertyFilters(filters: PropertyFilters | undefined): void {
  try { localStorage.setItem(storageKey, JSON.stringify(filters ?? {})); } catch { /* Keep filters for this session when storage is unavailable. */ }
}

export function parsePropertyFilters(raw: string | null): PropertyFilters {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, (string | null)[]] =>
      Array.isArray(entry[1]) && entry[1].every(value => value === null || typeof value === 'string')));
  } catch { return {}; }
}

export function activePropertyFilters(filters: PropertyFilters | undefined, settings: WorkspaceSettings, groupPropertyId?: string | null): PropertyFilters {
  return Object.fromEntries(settings.properties.flatMap(property => {
    const defaults = property.id === groupPropertyId ? [] : propertyChoices(property, 'resolved')
      .filter(choice => choice.id === null ? property.unsetShowByDefault === false : property.options.find(option => option.id === choice.id)?.showByDefault === false)
      .map(choice => choice.id);
    const selected = new Set((filters?.[property.id] ?? defaults).map(value =>
      !property.inheritFromParent && property.id === 'status' && property.defaultValue !== null && value === null ? property.defaultValue : value));
    const excluded = propertyChoices(property, 'resolved').map(value => value.id).filter(value => selected.has(value));
    return excluded.length ? [[property.id, excluded]] : [];
  }));
}

export function matchingItemIds(items: readonly Item[], filters: PropertyFilters, settings: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS): ReadonlySet<string> | undefined {
  const rules = Object.entries(filters);
  const byId = new Map(items.map(item => [item.id, item]));
  const properties = new Map(settings.properties.map(property => [property.id, property]));
  return rules.length ? new Set(items.filter(item => rules.every(([id, excluded]) => {
    const property = properties.get(id);
    const value = property ? effectivePropertyValue(item, property, byId) : propertyValue(item, id);
    return !excluded.includes(value);
  })).map(item => item.id)) : undefined;
}

/** Keep ancestors for navigation without making their other children match. */
export function withAncestors(items: readonly Item[], ids: ReadonlySet<string>): Set<string> {
  const byId = new Map(items.map(item => [item.id, item]));
  const result = new Set<string>();
  for (const id of ids) {
    let cursor: string | null = id;
    while (cursor && !result.has(cursor)) {
      result.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  return result;
}
