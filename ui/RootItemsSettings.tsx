import { useRef, useState } from 'react';
import type { Item, ItemCommand } from '../src/types';
import { childrenOf } from '../src/domain';
import { Icon } from './Icons';
import './workspace-settings.css';

export function RootItemsSettings({items, disabled, onCommand, onOpen}: {
  items: Item[]; disabled: boolean; onCommand: (command: ItemCommand) => Promise<void>; onOpen: (id: string) => void;
}) {
  const cancelledRename = useRef<string | null>(null);
  const roots = childrenOf(items, null);
  const [newTitle, setNewTitle] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (command: ItemCommand) => {
    setBusy(true); setError('');
    try { await onCommand(command); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; } finally { setBusy(false); }
  };
  const locked = disabled || busy;
  const reorder = (index: number, by: number) => {
    const ids = roots.map(item => item.id); const [id] = ids.splice(index, 1); ids.splice(index + by, 0, id!);
    void run({type: 'reorder', parentId: null, ids});
  };
  return <div className="lm-root-settings">
    <ul>{roots.map((item, index) => <li key={item.id}>
      <input aria-label={`Rename ${item.title}`} value={drafts[item.id] ?? item.title} maxLength={500} disabled={locked}
        onChange={event => setDrafts({...drafts, [item.id]: event.target.value})}
        onKeyDown={event => {if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') {cancelledRename.current = item.id; setDrafts({...drafts, [item.id]: item.title}); event.currentTarget.blur();}}}
        onBlur={() => { if (cancelledRename.current === item.id) {cancelledRename.current = null; return;} const value = drafts[item.id]?.trim(); if (value && value !== item.title) void run({type: 'update', id: item.id, patch: {title: value}}); else setDrafts(current => ({...current, [item.id]: item.title}));}} />
      <button aria-label={`Move ${item.title} up`} disabled={locked || index === 0} onClick={() => reorder(index, -1)}>↑</button>
      <button aria-label={`Move ${item.title} down`} disabled={locked || index === roots.length - 1} onClick={() => reorder(index, 1)}>↓</button>
      <button aria-label={`Open ${item.title}`} onClick={() => onOpen(item.id)}><Icon name="open-item" /></button>
      <button className="lm-danger" aria-label={`Delete ${item.title}`} disabled={locked} onClick={() => void run({type: 'delete', id: item.id})}>×</button>
    </li>)}</ul>
    <form onSubmit={event => {event.preventDefault(); if (newTitle.trim()) void run({type: 'create', parentId: null, title: newTitle.trim()}).then(saved => {if (saved) setNewTitle('');});}}>
      <input aria-label="New top-level Item" placeholder="New top-level Item…" maxLength={500} value={newTitle} disabled={locked} onChange={event => setNewTitle(event.target.value)} />
      <button disabled={locked || !newTitle.trim()}>Add</button>
    </form>
    {error && <p className="lm-error" role="alert">{error}</p>}
  </div>;
}
