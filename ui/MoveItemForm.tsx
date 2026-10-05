import { useState } from 'react';
import type { Item } from '../src/types';
import { moveParentOptions } from './item-hierarchy';

export function MoveItemForm({ item, items, workspaceName, disabled, onMove, onCancel }: {
  item: Item; items: Item[]; workspaceName: string; disabled: boolean;
  onMove: (parentId: string | null) => void; onCancel: () => void;
}) {
  const [parentId, setParentId] = useState(item.parentId ?? '');
  const options = moveParentOptions(items, item);
  const valid = parentId === '' || options.some(option => option.id === parentId);
  return <form onSubmit={event => {
    event.preventDefault();
    if (!disabled && valid && parentId !== (item.parentId ?? '')) onMove(parentId || null);
  }}>
    <label>Move to<select value={parentId} disabled={disabled} onChange={event => setParentId(event.target.value)}>
      <option value="">{workspaceName} (top level)</option>
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
    <div className="lm-modal-actions">
      <button type="button" disabled={disabled} onClick={onCancel}>Cancel</button>
      <button className="lm-primary" disabled={disabled || !valid || parentId === (item.parentId ?? '')}>Move</button>
    </div>
  </form>;
}
