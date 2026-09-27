import * as React from 'react';
import { STATUSES, type Item, type ItemCommand } from '../src/types';
import { childrenOf, computeEfforts, effectiveIncluded, localShare, allocationLimit } from '../src/domain';
import type { ItemPanelProps } from './contracts';
import { NotesEditor } from './NotesEditor';
import { ItemControls } from './ItemControls';
import { Icon } from './Icons';
import './item-panel.css';

const FINISHED = new Set<Item['status']>(['Done', 'Skip', 'Cut']);

function ancestorTrail(items: Item[], item: Item): Item[] {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  const trail: Item[] = [];
  const visited = new Set([item.id]);
  let parentId = item.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || visited.has(parent.id)) break;
    trail.unshift(parent);
    visited.add(parent.id);
    parentId = parent.parentId;
  }
  return trail;
}

function descendantsOf(items: Item[], rootId: string): Set<string> {
  const descendants = new Set([rootId]);
  const pending = [rootId];
  while (pending.length) {
    for (const child of childrenOf(items, pending.pop()!)) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id);
        pending.push(child.id);
      }
    }
  }
  descendants.delete(rootId);
  return descendants;
}

export function ItemPanel({
  item, items, showAll, readOnly = false, snapshotId, widgets, renderWidget, actWidget,
  uploadImage, onOpenItem, onCommand, onSelect, onNotesChange, notesStatus,
  promptTemplates = [], onSendToAgent,
}: ItemPanelProps) {
  const [titleDraft, setTitleDraft] = React.useState(item.title);
  const cancelTitle = React.useRef(false);
  const titleDirty = React.useRef(false);
  const [childDraft, setChildDraft] = React.useState('');
  const [childFormOpen, setChildFormOpen] = React.useState(false);
  const childInput = React.useRef<HTMLInputElement>(null);
  const cancelChildTitle = React.useRef<string | null>(null);
  const [childTitleDrafts, setChildTitleDrafts] = React.useState<Record<string, string>>({});
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [agentLink, setAgentLink] = React.useState<{ key: string; url?: string; error?: string } | null>(null);
  const [drag, setDrag] = React.useState<{ id: string; target: string } | null>(null);
  const dragRef = React.useRef<{ id: string; target: string; pointerId: number } | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const children = React.useMemo(() => childrenOf(items, item.id), [items, item.id]);
  const efforts = React.useMemo(() => computeEfforts(items), [items]);
  const trail = React.useMemo(() => ancestorTrail(items, item), [items, item]);
  const descendants = React.useMemo(() => descendantsOf(items, item.id), [items, item.id]);
  const parentOptions = React.useMemo(() => items
    .filter((candidate) => candidate.id !== item.id && !descendants.has(candidate.id))
    .map((candidate) => ({ id: candidate.id, label: [...ancestorTrail(items, candidate), candidate].map((part) => part.title).join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label)), [items, item.id, descendants]);
  const templateIds = promptTemplates.map((template) => template.id).join('\n');
  const defaultId = [item, ...trail.slice().reverse()].find((ancestor) =>
    ancestor.defaultPromptId && promptTemplates.some((template) => template.id === ancestor.defaultPromptId))?.defaultPromptId;
  const [templateId, setTemplateId] = React.useState(defaultId ?? promptTemplates[0]?.id ?? '');
  const locked = readOnly;
  const finishedIds = children.filter((child) => child.included && FINISHED.has(child.status)).map((child) => child.id);

  React.useEffect(() => { setTitleDraft(item.title); titleDirty.current = false; }, [item.id, item.title]);
  React.useEffect(() => {
    setChildDraft(''); setChildFormOpen(false); setSelected(new Set()); setError(null);
    setChildTitleDrafts({}); cancelChildTitle.current = null;
    setDrag(null); dragRef.current = null;
  }, [item.id]);
  React.useEffect(() => {
    setTemplateId(defaultId ?? promptTemplates[0]?.id ?? '');
    // The ID list keeps invocation choices stable when unrelated Item state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, defaultId, templateIds]);
  React.useEffect(() => {
    const ids = new Set(children.map((child) => child.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [children]);

  React.useEffect(() => {
    const currentTitles = new Map(children.map((child) => [child.id, child.title]));
    setChildTitleDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, draft] of Object.entries(current)) {
        if (!currentTitles.has(id) || currentTitles.get(id) === draft) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [children]);

  React.useEffect(() => {
    if (childFormOpen && children.length === 0) childInput.current?.focus();
  }, [childFormOpen, children.length]);

  const issue = async (command: ItemCommand): Promise<boolean> => {
    if (readOnly) return false;
    setError(null);
    try { await onCommand(command); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The change could not be saved.'); return false; }
  };
  const beginChildTitleEdit = (child: Item) => {
    if (locked) return;
    const draft = childTitleDrafts[child.id] ?? child.title;
    setChildTitleDrafts((current) => current[child.id] === draft ? current : { ...current, [child.id]: draft });
  };
  const updateChildTitleDraft = (id: string, draft: string) => {
    setChildTitleDrafts((current) => ({ ...current, [id]: draft }));
  };
  const cancelChildTitleEdit = (child: Item, suppressBlurSave = false) => {
    if (suppressBlurSave) cancelChildTitle.current = child.id;
    setChildTitleDrafts((current) => {
      if (!(child.id in current)) return current;
      const next = { ...current };
      delete next[child.id];
      return next;
    });
  };
  const saveChildTitle = (child: Item) => {
    if (locked) return;
    if (cancelChildTitle.current === child.id) {
      cancelChildTitle.current = null;
      return;
    }
    const draft = childTitleDrafts[child.id] ?? child.title;
    const title = draft.trim();
    if (!title || title === child.title) {
      cancelChildTitleEdit(child);
      if (!title) setChildTitleDrafts((current) => ({ ...current, [child.id]: child.title }));
      return;
    }
    void issue({ type: 'update', id: child.id, patch: { title } }).then((saved) => {
      if (!saved) return;
      // Keep the successful value visible until the dashboard rerender carries the
      // updated Item back. If the user started another edit meanwhile, leave it alone.
      setChildTitleDrafts((current) => current[child.id] === draft ? { ...current, [child.id]: title } : current);
    });
  };
  const bulk = (patch: Extract<ItemCommand, { type: 'bulk' }>['patch']) => {
    if (selected.size) void issue({ type: 'bulk', ids: [...selected], patch });
  };
  const reorder = (id: string, target: string) => {
    if (locked || id === target) return;
    const ids = children.map((child) => child.id);
    const from = ids.indexOf(id), to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1); ids.splice(to, 0, id);
    void issue({ type: 'reorder', parentId: item.id, ids });
  };
  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragRef.current = null; setDrag(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled) reorder(current.id, current.target);
  };
  const template = promptTemplates.find((candidate) => candidate.id === templateId);
  const linkKey = JSON.stringify([item.id, item.title, templateId, template?.prompt]);
  React.useEffect(() => {
    if (readOnly || !onSendToAgent || !templateId) return;
    let cancelled = false;
    // Preparing a URL is side-effect free. Only following the anchor opens Codex.
    void onSendToAgent(item.id, templateId).then((reply) => {
      if (!cancelled) setAgentLink({ key: linkKey, url: reply.url, error: reply.url ? undefined : reply.message });
    }).catch((cause) => {
      if (!cancelled) setAgentLink({ key: linkKey, error: cause instanceof Error ? cause.message : 'Could not prepare the Codex link.' });
    });
    return () => { cancelled = true; };
  }, [linkKey, item.id, templateId, readOnly, onSendToAgent]);
  const currentLink = !readOnly && agentLink?.key === linkKey ? agentLink : null;

  const remove = (target: Item) => {
    if (locked || snapshotId || deleting) return;
    const count = descendantsOf(items, target.id).size;
    if (!window.confirm(`Delete “${target.title}”${count ? ` and ${count} descendant${count === 1 ? '' : 's'}` : ''}? Historical snapshots will be preserved.`)) return;
    setDeleting(true);
    void issue({ type: 'delete', id: target.id }).finally(() => setDeleting(false));
  };
  const controls = (target: Item, detail = false) => <ItemControls key={target.id} item={target} detail={detail}
    hidden={!effectiveIncluded(items, target.id)} allocation={localShare(items, target.id)} allocationAutomatic={Boolean(target.allocationAuto)} allocationMax={allocationLimit(items, target.id)}
    effort={efforts[target.id] ?? 0} disabled={locked || deleting} allocationDisabled={showAll || !target.included}
    onIncluded={included => void issue({ type: 'update', id: target.id, patch: { included } })}
    onStatus={status => void issue({ type: 'update', id: target.id, patch: { status } })}
    onAllocation={share => void issue({ type: 'allocate', id: target.id, share })}
    onEffort={effortOverride => void issue({ type: 'update', id: target.id, patch: { effortOverride } })}
    onDelete={snapshotId ? undefined : () => remove(target)} />;

  return (
    <section className="lm-item-panel" aria-label={`Item details: ${item.title}`}>
      {readOnly && <div className="lm-item-panel__history" role="status">Historical snapshot · read only</div>}
      <header className="lm-item-panel__identity">
      <nav className="lm-item-panel__breadcrumbs" aria-label="Item path">
        {trail.map((ancestor) => <React.Fragment key={ancestor.id}>
          <button type="button" onClick={() => onSelect(ancestor.id)}>{ancestor.title}</button><span aria-hidden="true">/</span>
        </React.Fragment>)}
        <span className="lm-item-panel__current">
        <span className="lm-item-panel__title-wrap">
        <span className="lm-item-panel__title-measure" aria-hidden="true">{titleDraft || ' '}</span>
        <input className="lm-item-panel__title" aria-label="Title" value={titleDraft} disabled={locked}
          onChange={(event) => { titleDirty.current = true; setTitleDraft(event.target.value); }}
          onBlur={() => {
            if (cancelTitle.current) { cancelTitle.current = false; titleDirty.current = false; return; }
            if (!titleDirty.current) return;
            titleDirty.current = false;
            const title = titleDraft.trim();
            if (!title) setTitleDraft(item.title);
            else if (!locked && title !== item.title) void issue({ type: 'update', id: item.id, patch: { title } });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { cancelTitle.current = true; setTitleDraft(item.title); event.currentTarget.blur(); }
          }} />
        </span>
        </span>
      </nav>
      {controls(item, true)}
      </header>
      {currentLink?.error && <p className="lm-item-panel__error" role="alert">{currentLink.error}</p>}
      <details className="lm-item-panel__settings">
        <summary>Item settings</summary>
      {showAll && <p className="lm-item-panel__hint">Turn off Show all to edit allocation.</p>}
        <div className="lm-item-panel__settings-fields">
          <label><span>Parent</span><select aria-label="Parent item" value={item.parentId ?? ''} disabled={locked}
            onChange={(event) => { const parentId = event.target.value || null; if (parentId !== item.parentId) void issue({ type: 'move', id: item.id, parentId }); }}>
            <option value="">Top level</option>{parentOptions.map((parent) => <option key={parent.id} value={parent.id}>{parent.label}</option>)}
          </select></label>
          <label><span>Default agent prompt</span><select aria-label="Default agent prompt" value={item.defaultPromptId ?? ''} disabled={locked}
            onChange={(event) => void issue({ type: 'update', id: item.id, patch: { defaultPromptId: event.target.value || null } })}>
            <option value="">Inherit from parent</option>{promptTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select></label>

        </div>
      </details>
      {error && <p className="lm-item-panel__error" role="alert">{error}</p>}
      {(children.length > 0 || !locked) && <section className={`lm-item-panel__children${children.length === 0 ? ' lm-item-panel__children--empty' : ''}`} aria-labelledby={children.length ? 'lm-children-heading' : undefined} aria-label={children.length ? undefined : 'Children'}>
        {children.length > 0 && <div className="lm-item-panel__section-heading"><h2 id="lm-children-heading">Children <span>{children.length}</span></h2></div>}
        {children.length === 0 && !childFormOpen ? <button type="button" className="lm-item-panel__add-child" onClick={() => setChildFormOpen(true)}>+ Add child</button> : <form className="lm-item-panel__add" onSubmit={(event) => {
          event.preventDefault();
          const title = childDraft.trim();
          if (!locked && !adding && title) {
            setAdding(true);
            void issue({ type: 'create', parentId: item.id, title }).then((saved) => { if (saved) { setChildDraft(''); setChildFormOpen(false); } setAdding(false); });
          }
        }}>
          <input ref={childInput} aria-label="New child title" placeholder="Add a child…" value={childDraft} disabled={locked} onChange={(event) => setChildDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Escape' && children.length === 0 && !adding) { setChildFormOpen(false); setChildDraft(''); }
          }} />
          <button type="submit" disabled={locked || adding || !childDraft.trim()}>Add</button>
          {children.length === 0 && <button type="button" disabled={adding} onClick={() => { setChildFormOpen(false); setChildDraft(''); }}>Cancel</button>}
        </form>}
        {children.length > 0 && <>
          <div className="lm-item-panel__batch" aria-label="Child batch actions">
            <label><input type="checkbox" aria-label="Select all children" checked={selected.size === children.length}
              ref={(node) => { if (node) node.indeterminate = selected.size > 0 && selected.size < children.length; }}
              onChange={(event) => setSelected(event.target.checked ? new Set(children.map((child) => child.id)) : new Set())} />
              {selected.size ? `${selected.size} selected` : 'Select all'}</label>
            <select aria-label="Selected children status" value="" disabled={locked || !selected.size} onChange={(event) => bulk({ status: event.target.value as Item['status'] })}>
              <option value="" disabled>Status…</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
            <button type="button" disabled={locked || !selected.size} onClick={() => bulk({ included: true })}>Include</button>
            <button type="button" disabled={locked || !selected.size} onClick={() => bulk({ included: false })}>Hide</button>
            <button type="button" disabled={locked || !selected.size} onClick={() => bulk({ effortOverride: null })}>Clear effort</button>
            <button type="button" disabled={locked || !finishedIds.length} onClick={() => void issue({ type: 'bulk', ids: finishedIds, patch: { included: false } })}>Hide finished</button>
            {!snapshotId && <button type="button" className="lm-item-panel__danger" disabled={locked || deleting || !selected.size} onClick={() => {
              const ids = children.filter(child => selected.has(child.id)).map(child => child.id);
              if (!ids.length) return;
              const descendants = new Set(ids.flatMap(id => [...descendantsOf(items, id)]));
              if (!window.confirm(`Delete ${ids.length} selected child${ids.length === 1 ? '' : 'ren'}${descendants.size ? ` and ${descendants.size} descendant${descendants.size === 1 ? '' : 's'}` : ''}? Historical snapshots will be preserved.`)) return;
              setDeleting(true);
              void issue({ type: 'delete-many', ids }).then(saved => { if (saved) setSelected(new Set()); }).finally(() => setDeleting(false));
            }}>Delete</button>}
          </div>
          <ul className="lm-item-panel__child-list" ref={listRef}>
            {children.map((child) => {
              const included = effectiveIncluded(items, child.id);
              return <li key={child.id} data-child-id={child.id} className={[
                'lm-item-panel__child', !included && 'lm-item-panel__child--hidden',
                drag?.id === child.id && 'lm-item-panel__child--dragging',
                drag && drag.target === child.id && drag.id !== child.id && 'lm-item-panel__child--target',
              ].filter(Boolean).join(' ')}>
                <div className="lm-item-panel__child-name">
                  <input type="checkbox" aria-label={`Select ${child.title}`} checked={selected.has(child.id)} onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((current) => { const next = new Set(current); if (checked) next.add(child.id); else next.delete(child.id); return next; });
                  }} />
                  <button type="button" className="lm-item-panel__drag-handle" aria-label={`Drag to reorder ${child.title}`} disabled={locked}
                    onPointerDown={(event) => {
                      if (locked || event.button !== 0) return;
                      event.preventDefault();
                      dragRef.current = { id: child.id, target: child.id, pointerId: event.pointerId };
                      setDrag({ id: child.id, target: child.id });
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }} onPointerMove={(event) => {
                      const current = dragRef.current;
                      if (!current || current.pointerId !== event.pointerId) return;
                      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-child-id]') ?? []);
                      const target = rows.reduce<{ id: string; distance: number } | null>((closest, row) => {
                        const box = row.getBoundingClientRect();
                        const distance = Math.abs(event.clientY - (box.top + box.height / 2));
                        return !closest || distance < closest.distance ? { id: row.dataset.childId!, distance } : closest;
                      }, null)?.id;
                      if (target && target !== current.target) { current.target = target; setDrag({ id: current.id, target }); }
                    }} onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)}
                    onLostPointerCapture={() => { dragRef.current = null; setDrag(null); }}>⠿</button>
                  <input className="lm-item-panel__child-title" type="text" aria-label={`Rename ${child.title}`}
                    value={childTitleDrafts[child.id] ?? child.title} disabled={locked}
                    onFocus={() => beginChildTitleEdit(child)}
                    onChange={(event) => updateChildTitleDraft(child.id, event.target.value)}
                    onBlur={() => saveChildTitle(child)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                      if (event.key === 'Escape') { event.preventDefault(); cancelChildTitleEdit(child, true); event.currentTarget.blur(); }
                    }} />
                  <button className="lm-item-panel__child-open" type="button" aria-label={`Open ${child.title}`} title="Open child"
                    onClick={() => onSelect(child.id)}><Icon name="open-item" /></button>
                </div>
                {controls(child)}
              </li>;
            })}
          </ul>
        </>}
      </section>}
      <section className="lm-item-panel__notes" aria-labelledby="lm-notes-heading">
        <div className="lm-item-panel__section-heading"><h2 id="lm-notes-heading">Notes</h2>
          <div className="lm-item-panel__notes-actions">
            {notesStatus && notesStatus !== 'Saved' && <span role="status">{notesStatus}</span>}
      {onSendToAgent && <div className="lm-item-panel__agent">
        <span className="lm-inline-choice lm-item-panel__prompt">
          <select aria-label="Agent prompt template" value={templateId} disabled={readOnly || promptTemplates.length === 0}
            onChange={(event) => setTemplateId(event.target.value)}>
            {promptTemplates.length === 0 && <option value="">No prompt templates</option>}
            {promptTemplates.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          <a href={currentLink?.url} aria-disabled={!currentLink?.url} title={currentLink?.error ?? 'Open in Codex'}>{template?.name ?? 'No prompt templates'}</a>
          <span className="lm-inline-chevron" aria-hidden="true">⌄</span>
        </span>
        {!readOnly && templateId && !currentLink && <span className="lm-item-panel__hint" role="status">Preparing…</span>}
      </div>}
          </div>
        </div>
        <NotesEditor key={item.id} itemId={item.id} value={item.notes} readOnly={readOnly} snapshotId={snapshotId}
          widgets={widgets} renderWidget={renderWidget} actWidget={actWidget} uploadImage={uploadImage} onOpenItem={onOpenItem}
          onChange={(markdown) => { if (!readOnly) onNotesChange(item.id, markdown); }} />
      </section>
    </section>
  );
}
