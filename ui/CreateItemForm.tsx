import { useState } from 'react';
import { allocationLimit, computeEfforts, localShare, mutateItems } from '../src/domain';
import type { Item, ItemCommand } from '../src/types';
import { newClientId } from './navigation';
import { ItemControls } from './ItemControls';
import './item-panel.css';

export function CreateItemForm({ items, parentId, disabled, onCancel, onCreate }: {
  items: Item[]; parentId: string | null; disabled: boolean; onCancel: () => void;
  onCreate: (command: Extract<ItemCommand, { type: 'create' }>) => void;
}) {
  const [id] = useState(() => newClientId('item'));
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<Item['status']>('Later');
  const [included, setIncluded] = useState(true);
  const [share, setShare] = useState<number | null>(null);
  const [effortOverride, setEffort] = useState<number | null>(null);
  const command = { type: 'create' as const, id, parentId, title: title.trim() || 'New Item', patch: { status, included, effortOverride } };
  const automatic = mutateItems(items, command);
  const limit = allocationLimit(automatic, id);
  const hasSiblings = items.some(item => item.parentId === parentId && item.included);
  const explicitShare = share === null ? null : hasSiblings ? Math.min(share, limit) : 100;
  const preview = explicitShare === null ? automatic : mutateItems(items, { ...command, share: explicitShare });
  const item = preview.find(item => item.id === id)!;
  return <form onSubmit={event => { event.preventDefault(); if (title.trim()) onCreate({ ...command, share: explicitShare }); }}>
    <label>Title<input autoFocus required maxLength={500} disabled={disabled} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <div className="lm-item-panel lm-create-controls">
      <ItemControls item={item} detail hidden={!included} allocation={localShare(preview, id)} allocationAutomatic={share === null}
        allocationMax={limit} effort={computeEfforts(preview)[id] ?? 0} disabled={disabled} allocationDisabled={!included || !hasSiblings}
        onIncluded={value => { setIncluded(value); if (!value) setShare(null); }} onStatus={setStatus} onAllocation={setShare} onEffort={setEffort} />
    </div>
    <div className="lm-modal-actions"><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button>
      <button disabled={disabled || !title.trim()} className="lm-primary">Create Item</button></div>
  </form>;
}
