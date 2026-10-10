import { useState } from 'react';
import type { EnumProperty, Item, SaveSettingsInput, WorkspaceSettings } from '../src/types';
import { propertyValue, validateSettings } from '../src/properties';
import { newClientId } from './navigation';
import { ColorPicker } from './ColorPicker';
import { DEFAULT_UNSET_COLOR, nextPropertyColor } from './property-colors';
import './workspace-settings.css';

const copy = <T,>(value: T): T => structuredClone(value);
function move<T>(values: T[], from: number, by: number) {
  const next = [...values], to = from + by;
  if (to < 0 || to >= values.length) return next;
  const [value] = next.splice(from, 1); next.splice(to, 0, value!); return next;
}
function unsetLabel(property: EnumProperty): string {
  return property.id === 'status' ? 'No status' : property.unsetLabel;
}

export function WorkspaceSettingsEditor({ settings, items, disabled = false, onSave }: {
  settings: WorkspaceSettings; items: Item[]; disabled?: boolean;
  onSave: (input: Omit<SaveSettingsInput, 'expectedRevision'>, original: WorkspaceSettings) => Promise<void>;
}) {
  const [original, setOriginal] = useState(() => copy(settings));
  const [draft, setDraft] = useState(() => copy(settings));
  const [replacements, setReplacements] = useState<NonNullable<SaveSettingsInput['replacements']>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locked = disabled || saving;
  const edit = (id: string, change: Partial<EnumProperty>) => setDraft(current => ({...current,
    properties: current.properties.map(property => property.id === id ? {...property, ...change} : property)}));
  const removed = original.properties.flatMap(property => property.options.filter(option =>
    !draft.properties.find(value => value.id === property.id)?.options.some(value => value.id === option.id))
    .map(option => ({property, option, count: items.filter(item => propertyValue(item, property.id) === option.id).length})))
    .filter(value => value.count > 0);
  return <form className="lm-workspace-settings" noValidate onSubmit={event => {
    event.preventDefault(); if (locked) return;
    const normalized = {...draft, name: draft.name.trim(), properties: draft.properties.map(property => ({...property, name: property.name.trim(), unsetLabel: property.unsetLabel.trim(), options: property.options.map(option => ({...option, label: option.label.trim()}))}))};
    try { validateSettings(normalized); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    setSaving(true); setError('');
    const cleaned = Object.fromEntries(draft.properties.map(property => [property.id,
      Object.fromEntries(Object.entries(replacements[property.id] ?? {}).map(([old, next]) =>
        [old, next && property.options.some(option => option.id === next) ? next : null]))]).filter(([, values]) => Object.keys(values!).length > 0));
    void onSave({settings: normalized, replacements: cleaned}, original).then(() => {setDraft(copy(normalized)); setOriginal(copy(normalized)); setReplacements({});}).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setSaving(false));
  }}>
    <fieldset disabled={locked}>
      <label>Workspace name<input required maxLength={200} value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})} /></label>
      <label>Lifecycle property<select value={draft.lifecyclePropertyId ?? ''} onChange={event => setDraft({...draft, lifecyclePropertyId: event.target.value || null})}>
        <option value="">None</option>{draft.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
      </select></label>
      {draft.properties.map((property, propertyIndex) => <details className="lm-property-definition" key={property.id} ref={element => {if (element && property.name === '') element.open = true;}}>
        <summary>{property.name || 'New property'}</summary>
        <label>Property name<input aria-label={`Property name ${propertyIndex + 1}`} required maxLength={200} value={property.name} onChange={event => edit(property.id, {name: event.target.value})} /></label>
        <div className="lm-property-settings-row">
          <label>Unset label<input required maxLength={200} value={property.unsetLabel} onChange={event => edit(property.id, {unsetLabel: event.target.value})} /></label>
          <div className="lm-property-unset-color"><span>Unset color</span><ColorPicker label={`${property.name || 'New property'} unset color`} value={property.unsetColor} disabled={locked} onChange={color => edit(property.id, {unsetColor: color})} /></div>
        </div>
        <label>Default for new Items<select aria-label={`${property.name} default for new Items`} value={property.defaultValue ?? ''} onChange={event => edit(property.id, {defaultValue: event.target.value || null})}>
          <option value="">{unsetLabel(property)}</option>{property.options.map(option => <option key={option.id} value={option.id}>{option.label || 'New option'}</option>)}
        </select></label>
        {(property.id !== 'status' || property.defaultValue === null) && <label className="lm-property-visibility">
          <input type="checkbox" aria-label={`${property.name} ${unsetLabel(property)} show by default`} checked={property.unsetShowByDefault !== false}
            onChange={event => edit(property.id, {unsetShowByDefault: event.target.checked})} />{unsetLabel(property)}: Show by default
        </label>}
        <div className="lm-property-options">
          {property.options.map((option, index) => <div className="lm-property-option" key={option.id}>
            <ColorPicker label={`${option.label || 'New option'} color`} value={option.color} disabled={locked} onChange={color => edit(property.id, {options: property.options.map(value => value.id === option.id ? {...value, color} : value)})} />
            <input required aria-label={`${property.name} option ${index + 1}`} maxLength={200} value={option.label} placeholder="Option name" onChange={event => edit(property.id, {options: property.options.map(value => value.id === option.id ? {...value, label: event.target.value} : value)})} />
            <button type="button" aria-label={`Move ${option.label} up`} disabled={index === 0} onClick={() => edit(property.id, {options: move(property.options, index, -1)})}>↑</button>
            <button type="button" aria-label={`Move ${option.label} down`} disabled={index === property.options.length - 1} onClick={() => edit(property.id, {options: move(property.options, index, 1)})}>↓</button>
            <button type="button" aria-label={`Remove ${option.label}`} onClick={() => edit(property.id, {options: property.options.filter(value => value.id !== option.id), defaultValue: property.defaultValue === option.id ? null : property.defaultValue})}>×</button>
            <label className="lm-property-visibility"><input type="checkbox" aria-label={`${property.name} ${option.label || 'New option'} show by default`} checked={option.showByDefault !== false}
              onChange={event => edit(property.id, {options: property.options.map(value => value.id === option.id ? {...value, showByDefault: event.target.checked} : value)})} />Show by default</label>
            {draft.lifecyclePropertyId === property.id && <label className="lm-property-behavior">Effort behavior<select aria-label={`${option.label || 'New option'} effort behavior`} value={option.behavior ?? 'normal'} onChange={event => edit(property.id, {options: property.options.map(value => value.id === option.id ? {...value, behavior: event.target.value as 'normal' | 'complete' | 'skip'} : value)})}>
              <option value="normal">Normal</option><option value="complete">Completed</option><option value="skip">No calculated effort</option>
            </select></label>}
          </div>)}
        </div>
        <div className="lm-property-actions">
          <button type="button" onClick={() => edit(property.id, {options: [...property.options, {id: newClientId('option'), label: '', color: nextPropertyColor([property.unsetColor, ...property.options.map(option => option.color)]), behavior: 'normal'}]})}>+ Option</button>
          <button type="button" onClick={() => setDraft({...draft, properties: move(draft.properties, propertyIndex, -1)})} disabled={propertyIndex === 0}>Move property up</button>
          <button type="button" className="lm-danger" onClick={() => setDraft({...draft, lifecyclePropertyId: draft.lifecyclePropertyId === property.id ? null : draft.lifecyclePropertyId, properties: draft.properties.filter(value => value.id !== property.id)})}>Remove property</button>
        </div>
      </details>)}
      <button type="button" onClick={() => setDraft({...draft, properties: [...draft.properties, {id: newClientId('property'), name: '', options: [], unsetLabel: 'Unset', unsetColor: DEFAULT_UNSET_COLOR, defaultValue: null}]})}>+ Property</button>
      {removed.length > 0 && <div className="lm-property-removals">
        <p>Reassign removed options for current Items. Snapshots keep their original values.</p>
        {removed.map(({property, option, count}) => {
          const replacementProperty = draft.properties.find(value => value.id === property.id);
          return <label key={`${property.id}:${option.id}`}>{property.name}: {option.label} ({count} Items)
            {replacementProperty ? <select aria-label={`Replace ${property.name}: ${option.label}`} value={replacements[property.id]?.[option.id] ?? ''} onChange={event => setReplacements({...replacements, [property.id]: {...replacements[property.id], [option.id]: event.target.value || null}})}>
              <option value="">{unsetLabel(replacementProperty)}</option>{replacementProperty.options.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}
            </select> : <span>Property and current values will be removed.</span>}
          </label>;
        })}
      </div>}
      {draft.lifecyclePropertyId && <p className="lm-settings-help">Completed gives leaf Items 100% calculated effort. No calculated effort gives an Item and its branch 0%. Manual effort overrides either behavior.</p>}
      <div className="lm-modal-actions"><button type="button" onClick={() => {setDraft(copy(settings)); setOriginal(copy(settings)); setReplacements({}); setError('');}}>Reset changes</button><button className="lm-primary" type="submit">{saving ? 'Saving…' : 'Save workspace'}</button></div>
    </fieldset>
    {error && <p role="alert" className="lm-error">{error}</p>}
  </form>;
}
