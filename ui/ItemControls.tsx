import { STATUSES, type Item } from '../src/types';
import { PercentInput } from './PercentInput';

export function ItemControls({ item, hidden, allocation, allocationAutomatic, allocationMax = 100, effort, disabled, allocationDisabled,
  detail = false, onIncluded, onStatus, onAllocation, onEffort, onDelete }: {
  item: Item; hidden: boolean; allocation: number; allocationAutomatic: boolean; allocationMax?: number; effort: number;
  disabled: boolean; allocationDisabled: boolean; detail?: boolean;
  onIncluded: (included: boolean) => void; onStatus: (status: Item['status']) => void;
  onAllocation: (value: number | null) => void; onEffort: (value: number | null) => void; onDelete?: () => void;
}) {
  return <div className="lm-item-controls" aria-label={`${item.title} controls`}>
    <label className="lm-item-controls__inclusion" title="Included on dashboard">
      {hidden && <span className="lm-item-panel__hidden-label">Hidden</span>}
      <input type="checkbox" aria-label={detail ? 'Included on dashboard' : `${item.title} included on dashboard`}
        checked={item.included} disabled={disabled} onChange={event => onIncluded(event.target.checked)} />
    </label>
    <span className="lm-inline-choice lm-item-panel__status" data-status={item.status}>
      <span aria-hidden="true">{item.status}<span className="lm-inline-chevron">⌄</span></span>
      <select aria-label={detail ? 'Lifecycle status' : `${item.title} lifecycle status`} value={item.status} disabled={disabled}
        onChange={event => onStatus(event.target.value as Item['status'])}>
        {STATUSES.map(status => <option key={status}>{status}</option>)}
      </select>
    </span>
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
