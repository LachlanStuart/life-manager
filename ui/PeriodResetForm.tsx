import { useState } from 'react';
import { propertyValue } from '../src/properties';
import type { Item, ItemCommand, ItemPatch, WorkspaceSettings } from '../src/types';
import { propertyChoices } from './PropertySelect';

export function PeriodResetForm({ items, settings, busy, onCancel, onApply }: {
  items: Item[]; settings: WorkspaceSettings; busy: boolean;
  onCancel: () => void; onApply: (command: ItemCommand) => void;
}) {
  const [effort, setEffort] = useState(true);
  const [importance, setImportance] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(settings.properties.map(property => [property.id, property.defaultValue])));
  const patch: ItemPatch = {
    ...(effort ? { effortOverride: null } : {}),
    ...(importance ? { allocationAuto: true } : {}),
  };
  const properties = settings.properties.filter(property => selected[property.id]);
  for (const property of properties) {
    if (property.id === 'status') patch.status = values[property.id];
    else patch.properties = { ...patch.properties, [property.id]: values[property.id] };
  }
  const count = items.filter(item => (effort && item.effortOverride !== null)
    || (importance && !item.allocationAuto)
    || properties.some(property => propertyValue(item, property.id) !== values[property.id])).length;
  const affected = (count: number) => `${count} ${count === 1 ? 'Item' : 'Items'} would change`;

  return <form className="lm-period-reset" onSubmit={event => {
    event.preventDefault();
    if (!busy && count > 0) onApply({ type: 'bulk', ids: items.map(item => item.id), patch });
  }}>
    <p>Applies to all Items in the current period, including hidden Items and descendants. Historical snapshots are unaffected.</p>
    <fieldset disabled={busy}>
      <div className="lm-reset-option">
        <label><input type="checkbox" checked={effort} onChange={event => setEffort(event.target.checked)} />Return effort to Auto</label>
        <p>Clear manual assessments and calculate from children and lifecycle status. Done Items can still have 100% effort.</p>
        {effort && <small>{affected(items.filter(item => item.effortOverride !== null).length)}</small>}
      </div>
      <div className="lm-reset-option">
        <label><input type="checkbox" checked={importance} onChange={event => setImportance(event.target.checked)} />Return importance to Auto</label>
        <p>Clear manual allocations and divide attention equally among included siblings.</p>
        {importance && <small>{affected(items.filter(item => !item.allocationAuto).length)}</small>}
      </div>
      {settings.properties.map(property => <div className="lm-reset-option" key={property.id}>
        <div className="lm-reset-property">
          <label><input type="checkbox" checked={selected[property.id] ?? false} onChange={event => setSelected(current => ({ ...current, [property.id]: event.target.checked }))} />Set {property.name} to</label>
          <select aria-label={`${property.name} reset value`} disabled={!selected[property.id]} value={values[property.id] ?? ''}
            onChange={event => setValues(current => ({ ...current, [property.id]: event.target.value || null }))}>
            {propertyChoices(property).map(option => <option key={option.id ?? 'unset'} value={option.id ?? ''}>{option.label}{option.id === property.defaultValue ? ' (default)' : ''}</option>)}
          </select>
        </div>
        {selected[property.id] && <small>{affected(items.filter(item => propertyValue(item, property.id) !== values[property.id]).length)}</small>}
      </div>)}
    </fieldset>
    <p role="status">{count ? `${affected(count)} in total. Selected values will be replaced.` : 'No Items would change.'}</p>
    <div className="lm-modal-actions">
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="lm-primary" disabled={busy || count === 0}>{busy ? 'Applying…' : `Apply resets to ${count} ${count === 1 ? 'Item' : 'Items'}`}</button>
    </div>
  </form>;
}
