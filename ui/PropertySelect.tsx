import type { EnumProperty, Item, ItemPatch, WorkspaceSettings } from '../src/types';
import { resolvePropertyValue, type PropertyHierarchy } from '../src/properties';

export { effectivePropertyValue } from '../src/properties';

export interface PropertyChoice {
  id: string | null;
  label: string;
  color: string;
}

/**
 * Return the choices that should be exposed by an Item property picker.
 *
 * Editing exposes Inherit; grouping and filtering use only resolved options.
 * Legacy Status folds null into its creation default, or a No status bucket.
 */
export function propertyChoices(property: EnumProperty, mode: 'edit' | 'resolved' = 'edit'): PropertyChoice[] {
  const options = property.options.map(option => ({ id: option.id, label: option.label, color: option.color }));
  if (property.inheritFromParent) return mode === 'resolved' ? options : [{id: null, label: 'Inherit', color: property.unsetColor}, ...options];
  const defaultOption = property.defaultValue === null
    ? undefined
    : property.options.find(option => option.id === property.defaultValue);
  if (property.id === 'status' && defaultOption) return options;
  return [{ id: null, label: property.id === 'status' ? 'No status' : property.unsetLabel, color: property.unsetColor }, ...options];
}

export function selectedProperty(settings: WorkspaceSettings, propertyId?: string | null): EnumProperty | undefined {
  return settings.properties.find(property => property.id === propertyId)
    ?? settings.properties.find(property => property.id === 'status') ?? settings.properties[0];
}

export function propertyPatch(propertyId: string, value: string | null): ItemPatch {
  return propertyId === 'status' ? { status: value } : { properties: { [propertyId]: value } };
}

export function PropertySelect({ property, value, label, disabled, inline = false, item, items, onChange }: {
  property: EnumProperty; value: string | null; label: string; disabled?: boolean; inline?: boolean;
  item?: Item; items?: PropertyHierarchy;
  onChange: (value: string | null) => void;
}) {
  const effectiveValue = property.id === 'status' && !property.inheritFromParent ? value ?? property.defaultValue : value;
  const resolved = item ? resolvePropertyValue(item, property, items) : null;
  const inherited = item && property.inheritFromParent ? resolvePropertyValue({...item,
    ...(property.id === 'status' ? {status: null} : {properties: {...item.properties, [property.id]: null}})}, property, items) : null;
  const inheritedLabel = property.options.find(option => option.id === (inherited?.value ?? property.fallbackValue))?.label;
  const source = resolved?.inherited ? resolved.source ? `Inherited from ${resolved.source.title}` : 'Workspace default' : undefined;
  const choices = propertyChoices(property);
  const choice = choices.find(option => option.id === effectiveValue);
  const displayLabel = (option: PropertyChoice) => option.id === null && property.inheritFromParent && inheritedLabel ? `Inherit · ${inheritedLabel}` : option.label;
  const select = <select aria-label={label} title={source} value={effectiveValue ?? ''} disabled={disabled}
    onChange={event => onChange(event.target.value || null)}>
    {choices.map(option => <option key={option.id ?? 'unset'} value={option.id ?? ''}>{displayLabel(option)}</option>)}
  </select>;
  return inline ? <span className="lm-inline-choice lm-item-panel__status" title={source} style={{ color: property.options.find(option => option.id === resolved?.value)?.color ?? choice?.color ?? property.unsetColor }}>
    <span aria-hidden="true">{choice ? displayLabel(choice) : property.id === 'status' ? 'No status' : property.unsetLabel}<span className="lm-inline-chevron">⌄</span></span>
    {select}
  </span> : source ? <span className="lm-property-inheritance">{select}<small>{source}</small></span> : select;
}
