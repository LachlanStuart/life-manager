import type { EnumProperty, ItemPatch, WorkspaceSettings } from '../src/types';

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
  const option = property.options.find(option => option.id === value);
  const select = <select aria-label={label} value={value ?? ''} disabled={disabled}
    onChange={event => onChange(event.target.value || null)}>
    <option value="">{property.unsetLabel}</option>
    {property.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select>;
  return inline ? <span className="lm-inline-choice lm-item-panel__status" style={{ color: option?.color ?? property.unsetColor }}>
    <span aria-hidden="true">{option?.label ?? property.unsetLabel}<span className="lm-inline-chevron">⌄</span></span>
    {select}
  </span> : select;
}
