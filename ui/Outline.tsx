import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Item, ItemCommand, ItemPatch, WorkspaceSettings } from '../src/types';
import { allocationLimit, childrenOf, computeEfforts, localShare, mutateItems } from '../src/domain';
import { ItemControls } from './ItemControls';
import { selectedProperty, propertyPatch } from './PropertySelect';
import { Icon } from './Icons';
import { Modal } from './Modal';
import { MoveItemForm } from './MoveItemForm';
import { descendantsOf } from './item-hierarchy';
import { outlineModel, placement } from './outline-model';
import { propertyPresentation } from './property-presentation';
import type { ViewSort } from './view-sort';
import './item-panel.css';
import './outline.css';
import './item-row.css';

type Drop = { id: string; position: 'before' | 'after' | 'inside' };
type Gesture = { id: string; pointerId: number; x: number; y: number; active: boolean; drop: Drop | null };
type Undo = { command: Extract<ItemCommand, { type: 'restore-arrangement' }>; title: string; id: string };

export function Outline({ matchingIds, items, settings, propertyId, sort, selectedId, disabled, historical, revision, active, onOpen, onCommand }: {
  matchingIds?: ReadonlySet<string>;
  items: Item[]; settings: WorkspaceSettings; propertyId?: string | null; sort: ViewSort; selectedId: string | null;
  disabled: boolean; historical: boolean; revision: number; active: boolean;
  onOpen: (id: string) => void; onCommand: (command: ItemCommand, revision: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(() => new Set(items.filter(item => item.parentId === null).map(item => item.id)));
  const [all, setAll] = useState(true);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(new Set<string>());
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const cancelEdit = useRef(false);
  const [addingTo, setAddingTo] = useState<string | null | undefined>(undefined);
  const [newTitle, setNewTitle] = useState('');
  const [moving, setMoving] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState<Gesture | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const hover = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const bulkMenu = useRef<HTMLDetailsElement>(null);
  const locked = disabled || pending;
  const model = useMemo(() => outlineModel(items, expanded, all, query, settings, sort, propertyId, matchingIds), [items, expanded, all, query, settings, sort, propertyId, matchingIds]);
  const efforts = useMemo(() => computeEfforts(items, settings), [items, settings]);
  const property = selectedProperty(settings, propertyId);
  const selectedIds = items.filter(item => selection.has(item.id) && (!matchingIds || matchingIds.has(item.id))).map(item => item.id);
  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const focusRow = (id: string) => {
    const row = Array.from(rowsRef.current?.querySelectorAll<HTMLElement>('[data-outline-id]') ?? []).find(row => row.dataset.outlineId === id);
    row?.focus(); row?.scrollIntoView?.({ block: 'nearest' });
  };
  const revealRow = (id: string, hierarchy: Pick<Item, 'id' | 'parentId'>[]) => {
    setQuery(''); setAll(true);
    const byId = new Map(hierarchy.map(item => [item.id, item]));
    setExpanded(current => {
      const result = new Set(current); let parent = byId.get(id)?.parentId;
      while (parent) { result.add(parent); parent = byId.get(parent)?.parentId; }
      return result;
    });
    requestAnimationFrame(() => focusRow(id));
  };
  const clearHover = () => { if (hover.current) clearTimeout(hover.current.timer); hover.current = null; };
  const cancelDrag = () => { gesture.current = null; setDrag(null); clearHover(); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelDrag(); };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); clearHover(); };
  }, []);
  useEffect(() => { if (!active || disabled) { cancelDrag(); setMoving(null); setEditing(null); setAddingTo(undefined); } }, [active, disabled]);
  useEffect(() => {
    cancelDrag();
    if (matchingIds) setSelection(current => {
      const next = new Set([...current].filter(id => matchingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [matchingIds]);
  useEffect(() => { if (addingTo !== undefined && active) createRef.current?.focus(); }, [addingTo, active]);

  const issue = async (command: ItemCommand) => {
    if (disabled || pendingRef.current) return false;
    pendingRef.current = true; setPending(true); setError('');
    try { await onCommand(command, revision); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the change.'); return false; }
    finally { pendingRef.current = false; setPending(false); }
  };
  const closeBulkMenu = () => {
    if (bulkMenu.current) { bulkMenu.current.open = false; bulkMenu.current.querySelector('summary')?.focus(); }
  };
  const bulk = (patch: ItemPatch) => { if (selectedIds.length) { closeBulkMenu(); void issue({ type: 'bulk', ids: selectedIds, patch }); } };
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (bulkMenu.current && !bulkMenu.current.contains(event.target as Node)) bulkMenu.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const arrange = async (ids: string[], parentId: string | null, beforeId?: string) => {
    if (locked) return;
    const command: ItemCommand = { type: 'arrange', ids, parentId, ...(beforeId ? { beforeId } : {}) };
    let next: Item[];
    try { next = mutateItems(items, command, settings); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Cannot move here.'); return; }
    if (await issue(command)) {
      const title = ids.length === 1 ? items.find(item => item.id === ids[0])!.title : `${ids.length} selected Items`;
      setUndo({ title, id: ids[0]!, command: { type: 'restore-arrangement', placements: items.map(placement), expected: next.map(item => ({ ...placement(item), included: item.included })) } });
      setNotice(`Moved ${title} to ${items.find(item => item.id === parentId)?.title ?? settings.name}.`);
      setMoving(null);
      // A move must stay inspectable even if it leaves the search/dashboard filter.
      revealRow(ids[0]!, next);
    }
  };
  const drop = (current: Gesture) => {
    if (!current.active || !current.drop) return;
    const target = items.find(item => item.id === current.drop!.id);
    if (!target) return;
    if (current.drop.position === 'inside') { void arrange([current.id], target.id); return; }
    const siblings = childrenOf(items, target.parentId).filter(item => item.id !== current.id);
    const index = siblings.findIndex(item => item.id === target.id) + (current.drop.position === 'after' ? 1 : 0);
    void arrange([current.id], target.parentId, siblings[index]?.id);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
    current.active = true;
    const row = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>('[data-outline-id]');
    const id = row?.dataset.outlineId;
    const invalid = id === current.id || (id && descendantsOf(items, current.id).has(id));
    let target: Drop | null = null;
    if (row && id && !invalid && rowsRef.current?.contains(row)) {
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      const position = sort !== 'Order' || model.filtering ? 'inside' : ratio < .25 ? 'before' : ratio > .75 ? 'after' : 'inside';
      target = { id, position };
    }
    current.drop = target;
    if (target?.position === 'inside' && !expanded.has(target.id)) {
      if (hover.current?.id !== target.id) {
        clearHover(); const id = target.id;
        hover.current = { id, timer: setTimeout(() => { setExpanded(current => new Set([...current, id])); hover.current = null; }, 650) };
      }
    } else clearHover();
    const container = rowsRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      if (event.clientY < rect.top + 38) container.scrollTop -= 18;
      if (event.clientY > rect.bottom - 38) container.scrollTop += 18;
    }
    setDrag({ ...current });
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    cancelDrag();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled) drop(current);
  };
  const saveTitle = () => {
    if (cancelEdit.current) { cancelEdit.current = false; return; }
    if (!editing) return;
    const draft = editing; setEditing(null);
    const title = draft.title.trim();
    if (title && title !== items.find(item => item.id === draft.id)?.title) void issue({ type: 'update', id: draft.id, patch: { title } });
  };
  const beginAdd = (id: string | null) => {
    if (id) setExpanded(current => new Set([...current, id]));
    setAddingTo(id); setNewTitle('');
  };
  const creation = (depth: number) => <form className="lm-outline__create" style={{ '--outline-depth': depth } as CSSProperties} onSubmit={event => {
    event.preventDefault(); const title = newTitle.trim();
    if (!title || addingTo === undefined) return;
    void issue({ type: 'create', parentId: addingTo, title }).then(saved => { if (saved) { setNewTitle(''); requestAnimationFrame(() => createRef.current?.focus()); } });
  }}>
    <input ref={createRef} aria-label={`New Item under ${items.find(item => item.id === addingTo)?.title ?? settings.name}`} value={newTitle} maxLength={500} disabled={locked}
      placeholder={`Add to ${items.find(item => item.id === addingTo)?.title ?? settings.name}…`} onChange={event => setNewTitle(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape') { setAddingTo(undefined); if (addingTo) focusRow(addingTo); } }} />
    <button disabled={locked || !newTitle.trim()}>Add</button><button type="button" onClick={() => setAddingTo(undefined)}>Cancel</button>
  </form>;
  const remove = (item: Item) => {
    const count = descendantsOf(items, item.id).size;
    if (window.confirm(`Delete “${item.title}”${count ? ` and ${count} descendant${count === 1 ? '' : 's'}` : ''}? Historical snapshots will be preserved.`)) void issue({ type: 'delete', id: item.id });
  };
  const orderedSelected = () => outlineModel(items, new Set(items.map(item => item.id)), true, '', settings, 'Order', propertyId).rows.filter(row => selectedIds.includes(row.item.id)).map(row => row.item.id);
  const undoAvailable = undo && undo.command.expected.length === items.length && undo.command.expected.every(expected => {
    const item = items.find(item => item.id === expected.id);
    return item && item.parentId === expected.parentId && item.order === expected.order && item.weight === expected.weight && Boolean(item.allocationAuto) === Boolean(expected.allocationAuto) && item.included === expected.included;
  });
  return <section className="lm-outline" aria-label="Outline" hidden={!active}>
    <div className="lm-outline__toolbar">
      <strong>{settings.name}</strong>
      <input type="search" aria-label="Find in outline" placeholder="Find in outline…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
      <select aria-label="Outline visibility" value={all ? 'all' : 'dashboard'} onChange={event => setAll(event.target.value === 'all')}><option value="all">All Items</option><option value="dashboard">Dashboard only</option></select>
      <details className="lm-outline__expansion"><summary aria-label="Expand outline" title="Expand or collapse all"><span>Expand</span><span className="lm-outline__expand-icon" aria-hidden="true">↕</span></summary><div><button onClick={event => { setExpanded(new Set(items.map(item => item.id))); event.currentTarget.closest('details')!.open = false; }}>Expand all</button><button onClick={event => { setExpanded(new Set()); event.currentTarget.closest('details')!.open = false; }}>Collapse all</button></div></details>
      <button className="lm-outline__select" aria-label="Select" aria-pressed={selecting} disabled={disabled} onClick={() => { setSelecting(value => !value); setSelection(new Set()); }}>{selecting ? 'Done' : 'Select'}</button>
      <button className="lm-outline__add" aria-label="Add Item" title="Add Item" disabled={locked} onClick={() => beginAdd(null)}>+<span> Add Item</span></button>
    </div>
    {error && <p className="lm-outline__error" role="alert">{error}</p>}
    {notice && <div className="lm-outline__notice" role="status"><span>{notice}</span>{undoAvailable && <button disabled={locked} onClick={() => {
      if (!undo) return;
      void issue(undo.command).then(saved => { if (saved) { revealRow(undo.id, undo.command.placements); setUndo(null); setNotice(`Undid move of ${undo.title}.`); } });
    }}>Undo move</button>}<button aria-label="Dismiss move notice" onClick={() => { setNotice(''); setUndo(null); }}>×</button></div>}
    {drag?.active && <div className="lm-outline__drop-message" role="status">{drag.drop ? `${drag.drop.position === 'inside' ? 'Move into' : `Place ${drag.drop.position}`} ${items.find(item => item.id === drag.drop?.id)?.title}` : 'Choose a destination'}</div>}
    <div className="lm-outline__head" aria-hidden="true"><span>Item</span><span className="lm-outline__columns"><span>Included</span><span>{property?.name ?? ''}</span><span title="Share within parent">Allocation</span><span>Effort</span><span /></span><span /></div>
    <div className="lm-outline__rows" ref={rowsRef} role="tree" aria-label="Item hierarchy" aria-multiselectable={selecting || undefined}>
      {model.rows.map(({ item, depth, hasChildren, open, contextOnly }, index) => <div key={item.id}>
        <div className={`lm-outline__row lm-property-row${selectedId === item.id ? ' lm-outline__row--current' : ''}`} role="treeitem" tabIndex={0} aria-level={depth + 1}
          aria-expanded={hasChildren ? open : undefined} aria-selected={selecting ? selectedIds.includes(item.id) : undefined} aria-label={item.title}
          data-outline-id={item.id} data-depth={depth} data-hidden={!model.visible.has(item.id)} data-context={contextOnly}
          data-drop={drag?.drop?.id === item.id ? drag.drop.position : undefined} data-dragging={drag?.active && drag.id === item.id}
          style={{ '--outline-depth': depth, '--lm-row-color': propertyPresentation(item, property).color } as CSSProperties}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', 'F2', ' '];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'ArrowDown') focusRow(model.rows[Math.min(index + 1, model.rows.length - 1)]!.item.id);
            if (event.key === 'ArrowUp') focusRow(model.rows[Math.max(index - 1, 0)]!.item.id);
            if (event.key === 'Home') focusRow(model.rows[0]!.item.id);
            if (event.key === 'End') focusRow(model.rows[model.rows.length - 1]!.item.id);
            if (event.key === 'ArrowRight' && hasChildren) { if (!open) toggle(item.id); else focusRow(model.rows[index + 1]!.item.id); }
            if (event.key === 'ArrowLeft') { if (hasChildren && open && !model.filtering) toggle(item.id); else if (item.parentId) focusRow(item.parentId); }
            if (event.key === 'Enter') onOpen(item.id);
            if (event.key === 'F2' && !locked) setEditing({ id: item.id, title: item.title });
            if (event.key === ' ' && selecting && (!matchingIds || matchingIds.has(item.id))) setSelection(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
          }}>
          <div className="lm-outline__identity">
            {selecting && <input type="checkbox" aria-label={`Select ${item.title}`} disabled={Boolean(matchingIds && !matchingIds.has(item.id))} checked={selectedIds.includes(item.id)} onChange={event => setSelection(current => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />}
            <button className="lm-outline__grip" aria-label={`Drag ${item.title}`} title="Drag to move; use Move to for a distant destination" disabled={locked}
              onPointerDown={event => { if (event.button !== 0 || locked) return; event.preventDefault(); gesture.current = { id: item.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, drop: null }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
              onPointerMove={pointerMove} onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)} onLostPointerCapture={cancelDrag}>⠿</button>
            <button className="lm-outline__toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`} disabled={!hasChildren || model.filtering} onClick={() => toggle(item.id)}>{hasChildren ? open ? '▾' : '▸' : '·'}</button>
            <div className="lm-outline__name">
              {editing?.id === item.id ? <input autoFocus aria-label={`Rename ${item.title}`} value={editing.title} maxLength={500} onChange={event => setEditing({ id: item.id, title: event.target.value })} onBlur={saveTitle}
                onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelEdit.current = true; event.currentTarget.blur(); setEditing(null); focusRow(item.id); } if (event.key === 'Enter') event.currentTarget.blur(); }} />
                : <button className="lm-outline__title" disabled={locked} title={item.title} onClick={() => setEditing({ id: item.id, title: item.title })}>{item.title}</button>}
            </div>
            {hasChildren && !open && <span className="lm-outline__count" title="Immediate children">{model.children.get(item.id)?.length}</span>}
            <button className="lm-outline__open" aria-label={`Open ${item.title}`} onClick={() => onOpen(item.id)}><Icon name="open-item" /></button>
          </div>
          <ItemControls item={item} hidden={!model.visible.has(item.id)} allocation={localShare(items, item.id)} allocationAutomatic={Boolean(item.allocationAuto)} allocationMax={allocationLimit(items, item.id)}
            effort={efforts[item.id] ?? 0} settings={settings} propertyId={propertyId} disabled={locked} allocationDisabled={!item.included}
            onIncluded={included => void issue({ type: 'update', id: item.id, patch: { included } })}
            onProperty={(id, value) => void issue({ type: 'update', id: item.id, patch: propertyPatch(id, value) })}
            onAllocation={share => void issue({ type: 'allocate', id: item.id, share })}
            onEffort={effortOverride => void issue({ type: 'update', id: item.id, patch: { effortOverride } })}
            onDelete={historical ? undefined : () => remove(item)} />
          <div className="lm-outline__actions">
            <button aria-label={`Add child to ${item.title}`} title="Add child" disabled={locked} onClick={() => beginAdd(item.id)}>+</button>
            <details><summary aria-label={`Actions for ${item.title}`} title="Item actions">⋯</summary><div className="lm-outline__menu">
              <button disabled={locked} onClick={event => { setMoving([item.id]); event.currentTarget.closest('details')!.open = false; }}>Move to…</button>
              {selecting && <button onClick={event => { setSelection(current => new Set([...current, item.id, ...descendantsOf(items, item.id)])); event.currentTarget.closest('details')!.open = false; }}>Select branch</button>}
            </div></details>
          </div>
        </div>
        {addingTo === item.id && creation(depth + 1)}
      </div>)}
      {addingTo === null && creation(0)}
      {!model.rows.length && <p className="lm-outline__empty">{model.filtering ? 'No matching Items.' : all ? 'Add an Item to start your outline.' : 'No Items are included. Switch to All Items to choose some.'}</p>}
    </div>
    {selecting && <div className="lm-outline__bulk" role="toolbar" aria-label="Selected Item actions">
      <span role="status">{selectedIds.length} selected</span>
      <button onClick={() => setSelection(new Set(model.rows.filter(row => !row.contextOnly).map(row => row.item.id)))} aria-label="Select shown rows">All shown</button>
      <button onClick={() => setSelection(new Set())} aria-label="Clear selection" disabled={!selectedIds.length}>Clear</button>
      <details ref={bulkMenu} className="lm-outline__bulk-menu" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeBulkMenu(); } }}>
        <summary aria-label="Bulk actions" title="Selected Item actions">Actions <span aria-hidden="true">⌃</span></summary>
        <div className="lm-outline__bulk-options">
          <button disabled={locked || !selectedIds.length} onClick={() => bulk({ included: true })}>Include</button>
          <button disabled={locked || !selectedIds.length} onClick={() => bulk({ included: false })}>Exclude</button>
          {property && <select aria-label={`Set selected ${property.name}`} value="" disabled={locked || !selectedIds.length} onChange={event => bulk(propertyPatch(property.id, JSON.parse(event.target.value) as string | null))}>
            <option value="" disabled>{property.name}…</option><option value="null">{property.unsetLabel}</option>{property.options.map(option => <option key={option.id} value={JSON.stringify(option.id)}>{option.label}</option>)}
          </select>}
          <button disabled={locked || !selectedIds.length} onClick={() => { closeBulkMenu(); setMoving(orderedSelected()); }}>Move selected…</button>
          <button disabled={locked || !selectedIds.length} onClick={() => bulk({ allocationAuto: true })}>Allocation to Auto</button>
          <button disabled={locked || !selectedIds.length} onClick={() => bulk({ effortOverride: null })}>Effort to Auto</button>
        </div>
      </details>
    </div>}
    {moving && items.some(item => item.id === moving[0]) && <Modal title={moving.length === 1 ? `Move ${items.find(item => item.id === moving[0])!.title}` : `Move ${moving.length} Items`} error={error} onClose={() => !pending && setMoving(null)}>
      <MoveItemForm item={items.find(item => item.id === moving[0])!} movingIds={moving} items={items} workspaceName={settings.name} disabled={locked} onMove={parentId => void arrange(moving, parentId)} onCancel={() => setMoving(null)} />
    </Modal>}
  </section>;
}
