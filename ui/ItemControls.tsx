import type { Item, WorkspaceSettings } from '../src/types';
import { DEFAULT_WORKSPACE_SETTINGS, propertyValue } from '../src/properties';
import { PropertySelect, selectedProperty } from './PropertySelect';
import { PercentInput } from './PercentInput';

export function ItemControls({ item, hidden, allocation, allocationAutomatic, allocationMax = 100, effort, disabled, allocationDisabled,
  detail = false, settings, propertyId, onProperty, onIncluded, onStatus, onAllocation, onEffort, onDelete }: {
  item: Item; hidden: boolean; allocation: number; allocationAutomatic: boolean; allocationMax?: number; effort: number;
  disabled: boolean; allocationDisabled: boolean; detail?: boolean;
  settings?: WorkspaceSettings; propertyId?: string | null; onProperty?: (propertyId: string, value: string | null) => void;
  onIncluded: (included: boolean) => void; onStatus?: (status: Item['status']) => void;
  onAllocation: (value: number | null) => void; onEffort: (value: number | null) => void; onDelete?: () => void;
}) {
  const property = selectedProperty(settings ?? DEFAULT_WORKSPACE_SETTINGS, propertyId);
  const label = settings ? property?.name : 'Lifecycle status';
  return <div className="lm-item-controls" aria-label={`${item.title} controls`}>
    <label className="lm-item-controls__inclusion" title={hidden ? item.included ? 'Hidden by parent' : 'Excluded from dashboard' : 'Included on dashboard'}>
      {hidden && detail && <span className="lm-item-panel__hidden-label">Hidden</span>}
      <input type="checkbox" aria-label={detail ? 'Included on dashboard' : `${item.title} included on dashboard`}
        checked={item.included} disabled={disabled} onChange={event => onIncluded(event.target.checked)} />
    </label>
    {property && <PropertySelect property={property} value={propertyValue(item, property.id)}
      label={detail ? label! : `${item.title} ${settings ? label : 'lifecycle status'}`} disabled={disabled} inline
      onChange={value => { if (onProperty) onProperty(property.id, value); else if (property.id === 'status') onStatus?.(value); }} />}
    <PercentInput label={detail ? 'Intended attention percent' : `${item.title} allocation percent`} value={allocation}
      automatic={allocationAutomatic} clearOnContextMenu disabled={disabled || allocationDisabled} max={allocationMax} onSave={onAllocation} />
    <span className="lm-item-controls__multiply" aria-hidden="true">×</span>
    <PercentInput label={detail ? 'Manual effort percent' : `${item.title} effort percent`} value={effort}
      automatic={item.effortOverride === null} disabled={disabled} onSave={onEffort} />
    {onDelete && <button type="button" className="lm-item-controls__delete" aria-label={`Delete ${item.title}`} title="Delete Item"
      disabled={disabled} onClick={onDelete}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      </svg>
    </button>}
  </div>;
}
