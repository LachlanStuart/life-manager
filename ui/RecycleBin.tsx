import type { DeletedItemSummary, Item } from '../src/types';
import './recycle-bin.css';

export function RecycleBin({ entries, items, disabled, onRestore }: {
  entries: DeletedItemSummary[]; items: Item[]; disabled: boolean; onRestore: (id: string) => void;
}) {
  if (!entries.length) return <p>No deleted Items.</p>;
  return <div className="lm-recycle-bin">
    <p>Restore an Item together with its children.</p>
    <ul aria-label="Deleted Items">{entries.map(entry => {
      const parent = items.find(item => item.id === entry.parentId);
      return <li key={entry.id}>
        <div><strong>{entry.title}</strong><small>
          <time dateTime={entry.deletedAt}>{new Date(entry.deletedAt).toLocaleString()}</time>
          {entry.itemCount > 1 && <> · {entry.itemCount - 1} {entry.itemCount === 2 ? 'child' : 'descendants'}</>}
        </small><small>Restore to {parent?.title ?? 'top level'}{entry.parentId && !parent ? ' (original parent deleted)' : ''}</small></div>
        <button type="button" disabled={disabled} aria-label={`Restore ${entry.title}`} onClick={() => onRestore(entry.id)}>Restore</button>
      </li>;
    })}</ul>
  </div>;
}
