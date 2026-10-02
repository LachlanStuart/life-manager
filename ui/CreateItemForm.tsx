import { useState } from 'react';
import { allocationLimit, computeEfforts, localShare, mutateItems } from '../src/domain';
import type { Item, ItemCommand, WorkspaceSettings } from '../src/types';
import { DEFAULT_WORKSPACE_SETTINGS, propertyValue } from '../src/properties';
import { newClientId } from './navigation';
import { ItemControls } from './ItemControls';
import { PropertySelect } from './PropertySelect';
import './item-panel.css';

export function CreateItemForm({ items, parentId, disabled, settings, propertyId, initialValues, onCancel, onCreate }: {
  items: Item[]; parentId: string | null; disabled: boolean; onCancel: () => void;
  settings?: WorkspaceSettings; propertyId?: string | null; initialValues?: Record<string, string | null>;
  onCreate: (command: Extract<ItemCommand, { type: 'create' }>) => void;
}) {
  const configuration = settings ?? DEFAULT_WORKSPACE_SETTINGS;
  const [id] = useState(() => newClientId('item'));
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, string | null>>(() => Object.fromEntries(configuration.properties.map(property =>
    [property.id, initialValues && Object.hasOwn(initialValues, property.id) ? initialValues[property.id]! : property.defaultValue])));
  const [included, setIncluded] = useState(true);
  const [share, setShare] = useState<number | null>(null);
  const [effortOverride, setEffort] = useState<number | null>(null);
  const properties = Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'status'));
  const command = { type: 'create' as const, id, parentId, title: title.trim() || 'New Item', patch: {
    ...(Object.hasOwn(values, 'status') ? { status: values.status } : {}),
    ...(Object.keys(properties).length ? { properties } : {}), included, effortOverride,
  } };
  const automatic = mutateItems(items, command, configuration);
  const limit = allocationLimit(automatic, id);
  const hasSiblings = items.some(item => item.parentId === parentId && item.included);
  const explicitShare = share === null ? null : hasSiblings ? Math.min(share, limit) : 100;
  const preview = explicitShare === null ? automatic : mutateItems(items, { ...command, share: explicitShare }, configuration);
  const item = preview.find(item => item.id === id)!;
  const changeProperty = (id: string, value: string | null) => setValues(current => ({ ...current, [id]: value }));
  return <form onSubmit={event => { event.preventDefault(); if (!disabled && title.trim()) onCreate({ ...command, share: explicitShare }); }}>
    <label>Title<input autoFocus required maxLength={500} disabled={disabled} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <div className="lm-item-panel lm-create-controls">
      <ItemControls item={item} detail hidden={!included} allocation={localShare(preview, id)} allocationAutomatic={share === null}
        settings={settings} propertyId={propertyId} onProperty={changeProperty}
        allocationMax={limit} effort={computeEfforts(preview, configuration)[id] ?? 0} disabled={disabled} allocationDisabled={!included || !hasSiblings}
        onIncluded={value => { setIncluded(value); if (!value) setShare(null); }} onAllocation={setShare} onEffort={setEffort} />
      {configuration.properties.length > 0 && <details className="lm-item-panel__settings">
        <summary>Properties</summary>
        <div className="lm-item-panel__settings-fields">
          {configuration.properties.map(property => <label key={property.id}><span>{property.name}</span>
            <PropertySelect property={property} value={propertyValue(item, property.id)} label={`New item ${property.name}`} disabled={disabled}
              onChange={value => changeProperty(property.id, value)} />
          </label>)}
        </div>
      </details>}
    </div>
    <div className="lm-modal-actions"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button>
      <button disabled={disabled || !title.trim()} className="lm-primary">Create Item</button></div>
  </form>;
}
