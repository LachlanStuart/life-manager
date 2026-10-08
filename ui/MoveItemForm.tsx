import { useState } from 'react';
import type { Item } from '../src/types';
import { descendantsOf, moveParentOptions } from './item-hierarchy';

export function MoveItemForm({ item, items, workspaceName, disabled, onMove, onCancel, movingIds = [item.id] }: {
  item: Item; items: Item[]; workspaceName: string; disabled: boolean;
  movingIds?: string[];
  onMove: (parentId: string | null) => void; onCancel: () => void;
}) {
  const [parentId, setParentId] = useState(item.parentId ?? '');
  const [search, setSearch] = useState('');
  const excluded = new Set(movingIds.flatMap(id => [id, ...descendantsOf(items, id)]));
  const options = moveParentOptions(items, item).filter(option => !excluded.has(option.id));
  const valid = parentId === '' || options.some(option => option.id === parentId);
  const unchanged = movingIds.every(id => items.find(candidate => candidate.id === id)?.parentId === (parentId || null));
  return <form onSubmit={event => {
    event.preventDefault();
    if (!disabled && valid && !unchanged) onMove(parentId || null);
  }}>
    <label>Find a destination<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <label>Move to<select size={8} value={parentId} disabled={disabled} onChange={event => setParentId(event.target.value)}>
      <option value="">{workspaceName} (top level)</option>
      {options.filter(option => option.id === parentId || option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
    <div className="lm-modal-actions">
      <button type="button" disabled={disabled} onClick={onCancel}>Cancel</button>
      <button className="lm-primary" disabled={disabled || !valid || unchanged}>Move</button>
    </div>
  </form>;
}
