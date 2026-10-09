import type { EnumProperty, ItemPatch, WorkspaceSettings } from '../src/types';

export { effectivePropertyValue } from '../src/properties';

export interface PropertyChoice {
  id: string | null;
  label: string;
  color: string;
}

/**
 * Return the choices that should be exposed by an Item property picker.
 *
 * Status has a configured default, so its stored null value is represented by
 * that default in the UI. When the status default itself is null, keep a
 * neutral bucket so legacy null values still have somewhere to go, but call it
 * “No status” rather than exposing the generic Unset label.
 */
export function propertyChoices(property: EnumProperty): PropertyChoice[] {
  const options = property.options.map(option => ({ id: option.id, label: option.label, color: option.color }));
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

export function PropertySelect({ property, value, label, disabled, inline = false, onChange }: {
  property: EnumProperty; value: string | null; label: string; disabled?: boolean; inline?: boolean;
  onChange: (value: string | null) => void;
}) {
  const effectiveValue = property.id === 'status' ? value ?? property.defaultValue : value;
  const choices = propertyChoices(property);
  const choice = choices.find(option => option.id === effectiveValue);
  const select = <select aria-label={label} value={effectiveValue ?? ''} disabled={disabled}
    onChange={event => onChange(event.target.value || null)}>
    {choices.map(option => <option key={option.id ?? 'unset'} value={option.id ?? ''}>{option.label}</option>)}
  </select>;
  return inline ? <span className="lm-inline-choice lm-item-panel__status" style={{ color: choice?.color ?? property.unsetColor }}>
    <span aria-hidden="true">{choice?.label ?? (property.id === 'status' ? 'No status' : property.unsetLabel)}<span className="lm-inline-chevron">⌄</span></span>
    {select}
  </span> : select;
}
