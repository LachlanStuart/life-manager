import { effectivePropertyValue } from '../src/properties';
import type { EnumProperty, Item, WorkspaceSettings } from '../src/types';

export const NEUTRAL_PROPERTY_COLOR = '#7b8178';

/** An omitted channel uses status, then the first available field. Null disables it. */
export function presentationProperty(settings: WorkspaceSettings, id: string | null | undefined): EnumProperty | undefined {
  if (id === null) return undefined;
  return id === undefined
    ? settings.properties.find(property => property.id === 'status') ?? settings.properties[0]
    : settings.properties.find(property => property.id === id);
}

export function propertyPresentation(item: Item, property: EnumProperty | undefined) {
  if (!property) return { label: '', color: NEUTRAL_PROPERTY_COLOR };
  const option = property.options.find(option => option.id === effectivePropertyValue(item, property));
  return { label: option?.label ?? (property.id === 'status' ? 'No status' : property.unsetLabel), color: option?.color ?? property.unsetColor };
}
