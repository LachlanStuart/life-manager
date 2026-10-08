import type { Item, WorkspaceSettings } from '../src/types';
import { propertyValue } from '../src/properties';

/** Values switched off in the view. An absent property shows all its values. */
export type PropertyFilters = Record<string, (string | null)[]>;

export function parsePropertyFilters(raw: string | null): PropertyFilters {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, (string | null)[]] =>
      Array.isArray(entry[1]) && entry[1].every(value => value === null || typeof value === 'string')));
  } catch { return {}; }
}

export function activePropertyFilters(filters: PropertyFilters | undefined, settings: WorkspaceSettings): PropertyFilters {
  return Object.fromEntries(settings.properties.flatMap(property => {
    const excluded = [null, ...property.options.map(option => option.id)].filter(value => filters?.[property.id]?.includes(value));
    return excluded.length ? [[property.id, excluded]] : [];
  }));
}

export function matchingItemIds(items: readonly Item[], filters: PropertyFilters): ReadonlySet<string> | undefined {
  const rules = Object.entries(filters);
  return rules.length ? new Set(items.filter(item => rules.every(([id, excluded]) => !excluded.includes(propertyValue(item, id)))).map(item => item.id)) : undefined;
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
