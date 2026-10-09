import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { readPromptHandling, savePromptHandling, readT3Location, saveT3Location } from './ui/prompt-handling';
import { isDesktopClient, launchT3 } from './ui/t3-launch';
import { Modal } from './ui/Modal';
import { ItemContextMenu } from './ui/ItemContextMenu';
import { MoveItemForm } from './ui/MoveItemForm';
import { Icon } from './ui/Icons';
import { WorkspaceSettingsEditor } from './ui/WorkspaceSettingsEditor';
import { RootItemsSettings } from './ui/RootItemsSettings';
import { workspaceSettings } from './src/properties';
import { propertyPatch, selectedProperty } from './ui/PropertySelect';
import { FilterControl } from './ui/FilterControl';
import { activePropertyFilters, matchingItemIds, savePropertyFilters, type PropertyFilters } from './ui/property-filters';
import { SortControl } from './ui/SortControl';
import type { ViewSort } from './ui/view-sort';
import { PeriodControl } from './ui/PeriodControl';
import { PeriodResetForm } from './ui/PeriodResetForm';
import { Sunburst } from './ui/Sunburst';
import { CreateItemForm } from './ui/CreateItemForm';
import { Kanban } from './ui/Kanban';
import { Outline } from './ui/Outline';
import { api, uploadImage } from './ui/api';
import { initialRoute, newClientId, parseRoute, routeUrl, type ViewRoute } from './ui/navigation';
import { SunburstDisplaySettings } from './ui/SunburstDisplaySettings';
import { childrenOf, effectiveIncluded } from './src/domain';
import { type AgentReply, type Item, type ItemCommand, type PromptTemplate, type PromptHandling, type WidgetActionInput, type WidgetActionResult, type WidgetRenderInput, type WidgetRenderResult, type Workspace } from './src/types';
import type { WheelMode } from './ui/contracts';
import './ui/workspace.css';
import { appBase, browserDemo } from './ui/runtime';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type Draft = { itemId: string; markdown: string; snapshotId?: string };
const ItemPanel = lazy(() => import('./ui/ItemPanel').then(module => ({ default: module.ItemPanel })));

function parentPath(items: Item[], item: Item) {
  const parts: string[] = [];
  let parent = items.find(value => value.id === item.parentId);
  while (parent) { parts.unshift(parent.title); parent = items.find(value => value.id === parent!.parentId); }
  return parts.join(' / ');
}

export function LifeManagerPage() {
  const [route, setRoute] = useState<ViewRoute>(() => initialRoute(new URL(window.location.href)));
  const routeRef = useRef(route);
  useEffect(() => {
    // Record restored filters in this history entry before navigating away from it.
    if (routeRef.current.filters) window.history.replaceState(null, '', routeUrl(routeRef.current));
  }, []);
  useEffect(() => { savePropertyFilters(route.filters); }, [route.filters]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const latest = useRef<Workspace | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(route.itemId);
  const [mode, setMode] = useState<WheelMode>(() => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ? 'Omni' : 'Navigate');
  const [contextItem, setContextItem] = useState<{id: string; x: number; y: number} | null>(null);
  const [moveItemId, setMoveItemId] = useState<string | null>(null);
  const [viewSorts, setViewSorts] = useState<Record<'sunburst' | 'kanban' | 'outline', ViewSort>>({sunburst: 'Order', kanban: 'Order', outline: 'Order'});
  const [colorChannel, setColorChannel] = useState<string | null | undefined>(undefined);
  const [groupChannel, setGroupChannel] = useState<string | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const [createValues, setCreateValues] = useState<Record<string, string | null> | undefined>();
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const pending = useRef<Draft | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const [noteStatus, setNoteStatus] = useState('Saved');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [paneWidth, setPaneWidth] = useState(46);
  const [expanded, setExpanded] = useState(false);
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [periodName, setPeriodName] = useState('');
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [searchItems, setSearchItems] = useState<Item[]>([]);
  const [promptHandling, setPromptHandling] = useState(readPromptHandling);
  const [t3Location, setT3Location] = useState(readT3Location);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate>({ id: '', name: '', prompt: '' });
  const frame = useRef<HTMLDivElement>(null);
  const backgroundPress = useRef<{target: EventTarget; x: number; y: number} | null>(null);

  const accept = useCallback((next: Workspace) => {
    if ((next.dashboard.snapshotId ?? undefined) !== routeRef.current.snapshotId) return;
    const prior = latest.current?.dashboard;
    if (prior && prior.snapshotId === next.dashboard.snapshotId && prior.periodId === next.dashboard.periodId && prior.revision > next.dashboard.revision) return;
    latest.current = next; setWorkspace(next);
  }, []);
  const refresh = useCallback(async () => {
    const snapshot = routeRef.current.snapshotId;
    const next = await api<Workspace>(`workspace${snapshot ? `?snapshotId=${encodeURIComponent(snapshot)}` : ''}`);
    if (snapshot === routeRef.current.snapshotId) accept(next);
  }, [accept]);
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(operation); queue.current = result.catch(() => undefined); return result;
  }, []);
  const command = useCallback((value: ItemCommand, expectedRevision?: number) => enqueue(async () => {
    const current = latest.current;
    if (!current || (current.dashboard.snapshotId ?? undefined) !== routeRef.current.snapshotId) throw new Error('Wait for the dashboard to load.');
    try {
      if (expectedRevision !== undefined && expectedRevision !== current.dashboard.revision) throw new Error('The dashboard changed. Check the Item before trying again.');
      const next = await api<Workspace>('mutate', { snapshotId: current.dashboard.snapshotId ?? undefined, expectedRevision: current.dashboard.revision, command: value });
      accept(next); setError('');
      if (routeRef.current.itemId && !next.dashboard.items.some(item => item.id === routeRef.current.itemId)) {
        const previous = current.dashboard.items.find(item => item.id === routeRef.current.itemId);
        const updated = { ...routeRef.current, itemId: previous?.parentId ?? null };
        if (updated.focusId && !next.dashboard.items.some(item => item.id === updated.focusId)) updated.focusId = null;
        window.history.replaceState(null, '', routeUrl(updated)); routeRef.current = updated; setRoute(updated);
      }
    } catch (cause) { setError(message(cause)); await refresh().catch(() => undefined); throw cause; }
  }), [enqueue, accept, refresh]);

  const saveNotes = useCallback((): Promise<void> => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (saving.current) return saving.current;
    if (!pending.current) return Promise.resolve();
    const task = (async () => {
      while (pending.current) {
        const value = pending.current;
        if (value.snapshotId !== routeRef.current.snapshotId) throw new Error('Return to the edited snapshot to save these notes.');
        setNoteStatus('Saving…');
        await command({ type: 'update', id: value.itemId, patch: { notes: value.markdown } });
        if (pending.current === value) { pending.current = null; setDraft(null); setNoteStatus('Saved'); }
      }
    })();
    saving.current = task;
    void task.catch(() => setNoteStatus('Save error')).finally(() => { saving.current = null; });
    return task;
  }, [command]);
  const changeNotes = useCallback((itemId: string, markdown: string) => {
    const stored = latest.current?.dashboard.items.find(item => item.id === itemId)?.notes;
    if (!pending.current && markdown === stored) return;
    const value = { itemId, markdown, snapshotId: routeRef.current.snapshotId };
    pending.current = value; setDraft(value); setNoteStatus('Saving…');
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => { void saveNotes().catch(() => undefined); }, 650);
  }, [saveNotes]);
  useEffect(() => {
    window.lifeManagerFlush = async () => { await saveNotes(); await queue.current; };
    return () => { delete window.lifeManagerFlush; };
  }, [saveNotes]);
  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); setError(''); } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }, []);
  const applyRoute = useCallback(async (next: ViewRoute, push: boolean) => {
    await saveNotes(); await queue.current;
    const changedSnapshot = next.snapshotId !== routeRef.current.snapshotId;
    if (push) window.history.pushState(null, '', routeUrl(next));
    routeRef.current = next; setRoute(next); setSearch(''); setExpanded(false); setHighlightId(next.itemId);
    if (changedSnapshot) { setCorrecting(false); latest.current = null; setWorkspace(null); await refresh(); }
  }, [saveNotes, refresh]);
  const navigate = useCallback((next: ViewRoute) => { void run(() => applyRoute(next, true)); }, [run, applyRoute]);
  const select = useCallback((id: string) => navigate({ ...routeRef.current, itemId: id }), [navigate]);
  const focus = useCallback((id: string | null) => navigate({ ...routeRef.current, itemId: null, focusId: id }), [navigate]);

  useEffect(() => {
    void refresh().catch(cause => setError(message(cause)));
    const onPop = () => {
      const next = parseRoute(new URL(window.location.href));
      void run(async () => { try { await applyRoute(next, false); } catch (cause) { window.history.replaceState(null, '', routeUrl(routeRef.current)); throw cause; } });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void saveNotes().catch(() => undefined);
      else void queue.current.then(refresh).catch(cause => setError(message(cause)));
    };
    const onPageHide = () => { void saveNotes().catch(() => undefined); };
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    const feed = browserDemo || typeof EventSource === 'undefined' ? null : new EventSource('/api/events');
    const onChanged = () => { void queue.current.then(refresh).catch(cause => setError(message(cause))); };
    feed?.addEventListener('changed', onChanged);
    feed?.addEventListener('ready', onChanged);
    return () => { window.removeEventListener('popstate', onPop); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onPageHide); feed?.close(); if (noteTimer.current) clearTimeout(noteTimer.current); };
  }, [applyRoute, refresh, run, saveNotes]);

  useEffect(() => {
    if (!search.trim()) return;
    if (!route.snapshotId) { setSearchItems(workspace?.dashboard.items ?? []); return; }
    let active = true;
    void api<Workspace>('workspace').then(value => { if (active) setSearchItems(value.dashboard.items); }).catch(cause => setError(message(cause)));
    return () => { active = false; };
  }, [search, route.snapshotId, workspace]);

  const renderWidget = useCallback((input: WidgetRenderInput) => api<WidgetRenderResult>('widgets/render', input), []);
  const actWidget = useCallback(async (input: WidgetActionInput) => { await saveNotes(); const result = await api<WidgetActionResult>('widgets/action', input); await refresh(); return result; }, [saveNotes, refresh]);
  const sendToAgent = useCallback((itemId: string, templateId: string) => api<AgentReply>('agent/link', { itemId, templateId, target: promptHandling,
    ...(promptHandling === 't3' && isDesktopClient() ? { context: 'client' } : {}),
  }), [promptHandling]);

  const settings = workspaceSettings(workspace ?? undefined);
  const channel = (id: string | null | undefined) => id === null ? null : settings.properties.some(property => property.id === id) ? id! : settings.properties.find(property => property.id === 'status')?.id ?? settings.properties[0]?.id ?? null;
  const colorPropertyId = channel(colorChannel), groupPropertyId = channel(groupChannel);
  const items = workspace?.dashboard.items ?? [];
  const filters = useMemo(() => activePropertyFilters(route.filters, settings), [route.filters, settings]);
  const matchingIds = useMemo(() => matchingItemIds(items, filters, settings), [items, filters, settings]);
  const changeFilters = (filters: PropertyFilters) => {
    const next = {...routeRef.current, filters: Object.keys(filters).length ? filters : undefined};
    window.history.pushState(null, '', routeUrl(next));
    routeRef.current = next; setRoute(next); setContextItem(null);
  };
  const selected = items.find(item => item.id === route.itemId);
  const displayed = selected && draft?.itemId === selected.id && draft.snapshotId === route.snapshotId ? { ...selected, notes: draft.markdown } : selected;
  const historical = Boolean(route.snapshotId);
  const readOnly = historical && !correcting;
  useEffect(() => { setContextItem(null); setMoveItemId(null); }, [route.focusId, route.snapshotId, route.view, mode]);
  const movingItem = items.find(item => item.id === moveItemId);
  const board = route.view === 'kanban';
  const outline = route.view === 'outline';
  const editPropertyId = board ? groupPropertyId : outline ? selectedProperty(settings, colorPropertyId)?.id ?? null : colorPropertyId;
  const viewSort = viewSorts[route.view ?? 'sunburst'];
  const focusedItem = items.find(item => item.id === route.focusId);
  const focusAncestors: Item[] = [];
  let ancestor = items.find(item => item.id === focusedItem?.parentId);
  while (ancestor) {
    focusAncestors.unshift(ancestor);
    ancestor = items.find(item => item.id === ancestor!.parentId);
  }
  const childBranches = childrenOf(items, focusedItem?.id ?? null)
    .filter(item => (showAll || item.included) && items.some(child => child.parentId === item.id));
  const results = search.trim() ? searchItems.filter(item => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).slice(0, 40) : [];
  const beginCreate = (parentId: string) => {
    setCreateValues(undefined); setCreateParent(parentId);
  };
  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !frame.current) return;
    const rect = frame.current.getBoundingClientRect(); setPaneWidth(Math.min(82, Math.max(30, (rect.right - event.clientX) / rect.width * 100)));
  }
  const setTemplate = (id: string) => setEditingTemplate(workspace?.promptTemplates.find(value => value.id === id) ?? { id: '', name: '', prompt: '' });

  return <main className="lm-workspace" aria-label="Life Manager" data-view={route.view ?? 'sunburst'} data-item-open={Boolean(route.itemId)}>
    <header className="lm-header">
      <a className="lm-brand" aria-label="Life Manager" href={routeUrl({ itemId: null, focusId: null })} onClick={event => { event.preventDefault(); navigate({ itemId: null, focusId: null }); }}><img src={`${appBase}favicon.svg`} alt="" /><h1>Life Manager</h1></a>
      <div className="lm-search"><input aria-label="Find an Item" type="search" placeholder="Find an Item" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setSearch(''); }} />
        {search.trim() && <div className="lm-search-results" role="listbox" aria-label="Search results">{results.length ? results.map(item => <button key={item.id} role="option" aria-selected={item.id === route.itemId} onClick={() => navigate({ ...routeRef.current, itemId: item.id, focusId: null })}><span>{item.title}</span><small>{parentPath(searchItems, item)}{!effectiveIncluded(searchItems, item.id) ? ' · hidden' : ''}</small></button>) : <span>No matching Items</span>}</div>}
      </div>
      <PeriodControl workspace={workspace} snapshotId={route.snapshotId} busy={busy} onSelect={snapshotId => navigate({ ...routeRef.current, snapshotId })}
        onPlan={() => void run(async () => { await saveNotes(); await enqueue(async () => accept(await api<Workspace>('plan', { expectedRevision: latest.current!.dashboard.revision }))); })}
        onNext={() => { setPeriodName(''); setRolloverOpen(true); }}
        onReset={() => { setError(''); setResetOpen(true); }} />
      <button className="lm-settings-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings"><Icon name="settings" /></button>
    </header>
    <div className="lm-period-controls">
      <div className="lm-mode-picker lm-view-picker" role="group" aria-label="Dashboard view">
        <button aria-pressed={!board && !outline} aria-label="Sunburst" title="Sunburst" onClick={() => navigate({ ...routeRef.current, view: undefined })}><Icon name="sunburst" /><span className="lm-tool-text">Sunburst</span></button>
        <button aria-pressed={board} aria-label="Kanban" title="Kanban" onClick={() => navigate({ ...routeRef.current, view: 'kanban' })}><Icon name="kanban" /><span className="lm-tool-text">Kanban</span></button>
        <button aria-pressed={outline} aria-label="Outline" title="Outline" onClick={() => navigate({ ...routeRef.current, view: 'outline' })}><Icon name="outline" /><span className="lm-tool-text">Outline</span></button>
      </div>
      {!board && !outline && <div className="lm-mode-picker lm-wheel-mode-picker" role="group" aria-label="Wheel mode">{(['Omni', 'Navigate', 'Importance', 'Effort', 'Create'] as WheelMode[]).map(value => <button key={value} aria-label={value} title={value} aria-pressed={mode === value} disabled={readOnly && ['Importance', 'Effort', 'Create'].includes(value)} onClick={() => setMode(value)}><Icon name={value} /><span className="lm-tool-text">{value}</span></button>)}</div>}
      {!outline && <button disabled={!workspace || busy || readOnly} onClick={() => { setCreateValues(undefined); setCreateParent(focusedItem?.id ?? null); }}>+ New</button>}
      {settings.properties.length > 0 && <label className="lm-property-view-control" title={`Color by: ${settings.properties.find(property => property.id === (outline ? editPropertyId : colorPropertyId))?.name ?? 'None'}`}><span>Color by ⌄</span><select aria-label="Color by" value={(outline ? editPropertyId : colorPropertyId) ?? ''} onChange={event => setColorChannel(event.target.value || null)}>
        {!outline && <option value="">None</option>}{settings.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
      </select></label>}
      {board && settings.properties.length > 0 && <label className="lm-property-view-control" title={`Group by: ${settings.properties.find(property => property.id === groupPropertyId)?.name ?? 'None'}`}><span>Group by ⌄</span><select aria-label="Group by" value={groupPropertyId ?? ''} onChange={event => setGroupChannel(event.target.value || null)}>
        <option value="">None</option>{settings.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
      </select></label>}
      <SortControl propertyName={settings.properties.find(property => property.id === editPropertyId)?.name} value={viewSort} onChange={sort => setViewSorts(current => ({...current, [route.view ?? 'sunburst']: sort}))} />
      <FilterControl settings={settings} filters={filters} onChange={changeFilters} showAll={showAll} onShowAllChange={setShowAll} />
      {historical && <button disabled={busy} onClick={() => void run(async () => { await saveNotes(); setCorrecting(value => !value); })}>{correcting ? 'Finish correction' : 'Correct this snapshot'}</button>}
      {historical && <span className="lm-snapshot-badge">{correcting ? 'Correcting snapshot' : 'Snapshot'}</span>}
    </div>
    {error && <div className="lm-error" role="alert"><span>{error}</span><button onClick={() => void run(async () => { await saveNotes(); await refresh(); })}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
    {!workspace ? <div className="lm-loading" role="status">Loading…</div> : <div className={`lm-main ${expanded ? 'lm-main-expanded' : ''}`} data-item-open={Boolean(route.itemId)} ref={frame} style={{ '--lm-pane-width': `${paneWidth}%` } as CSSProperties}>
      <section className={`lm-chart-pane${outline ? ' lm-chart-pane--outline' : board ? ' lm-chart-pane--board' : ''}`} aria-label="Attention dashboard"
        onPointerDown={event => {
          const target = event.target;
          backgroundPress.current = target instanceof Element && target.matches('.lm-chart-pane, .lm-board-layout, .lm-kanban, .lm-kanban__board, .lm-kanban__column-dropzone, .lm-kanban__cards, .lm-wheel-space, .lm-sunburst, .lm-sunburst__stage, .lm-sunburst__svg, .lm-sunburst__backdrop')
            ? {target, x: event.clientX, y: event.clientY} : null;
        }}
        onClick={event => {
          const down = backgroundPress.current; backgroundPress.current = null;
          if (route.itemId && down?.target === event.target && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) {
            navigate({ ...routeRef.current, itemId: null });
          }
        }}>
        <Outline key={`${workspace.dashboard.periodId}:${route.snapshotId ?? 'current'}`} active={outline} showAll={showAll} onShowAllChange={setShowAll} items={items} matchingIds={matchingIds} settings={settings} propertyId={editPropertyId} sort={viewSorts.outline}
          selectedId={route.itemId} disabled={readOnly || busy} historical={historical} revision={workspace.dashboard.revision} onOpen={select}
          onCommand={async (value, revision) => {
            if (routeRef.current.snapshotId !== route.snapshotId || latest.current?.dashboard.periodId !== workspace.dashboard.periodId) throw new Error('The dashboard changed. Check the Item before trying again.');
            if (value.type === 'delete' || value.type === 'delete-many') await saveNotes();
            await command(value, revision);
          }} />
        {outline ? null : board ? <div className="lm-board-layout">
          <aside className="lm-board-scope" aria-label="Board focus">
            <Sunburst matchingIds={matchingIds} settings={settings} colorPropertyId={colorPropertyId} sort={viewSort} items={items} selectedId={null} focusId={focusedItem?.id ?? null} showAll={showAll} compact mode="Navigate"
              onSelect={select} onFocus={focus} onAllocate={() => undefined} onContextMenu={(id, x, y) => setContextItem({id, x, y})} />
            <nav aria-label="Focus branch">
              {focusedItem && <button onClick={() => focus(null)}>↑ {settings.name}</button>}
              {focusAncestors.map(item => <button key={item.id} onClick={() => focus(item.id)}>↑ {item.title}</button>)}
              <div className="lm-board-current">
                <button aria-current="true" onClick={() => focus(focusedItem?.id ?? null)}>{focusedItem?.title ?? settings.name}</button>
                {focusedItem && <button onClick={() => select(focusedItem.id)}>Open</button>}
              </div>
              {childBranches.map(item => <button key={item.id} onClick={() => focus(item.id)}>{item.title}</button>)}
            </nav>
          </aside>
          <Kanban showAll={showAll} onCreate={(parentId, values) => { setCreateValues(values); setCreateParent(parentId); }} matchingIds={matchingIds} settings={settings} colorPropertyId={colorPropertyId} groupPropertyId={groupPropertyId} sort={viewSort} items={items} focusId={focusedItem?.id ?? null} selectedId={route.itemId} disabled={readOnly || busy}
            onSelect={select} onContextMenu={(id, x, y) => setContextItem({id, x, y})} onCommand={async value => {
              if (routeRef.current.snapshotId !== route.snapshotId || latest.current?.dashboard.periodId !== workspace.dashboard.periodId) {
                const reason = 'The dashboard changed during this move. Check the Item before trying again.';
                setError(reason); throw new Error(reason);
              }
              await command(value);
            }} />
        </div> : <>

        <div className="lm-wheel-space"><Sunburst matchingIds={matchingIds} settings={settings} colorPropertyId={colorPropertyId} sort={viewSort} items={items} selectedId={highlightId ?? route.itemId} focusId={route.focusId && items.some(item => item.id === route.focusId) ? route.focusId : null} showAll={showAll} mode={mode}
          onSelect={id => { setHighlightId(id); select(id); }} onHighlight={setHighlightId} onFocus={focus} onShowHidden={() => setShowAll(true)} onCreate={beginCreate} onContextMenu={(id, x, y) => setContextItem({id, x, y})} disabled={readOnly || busy}
          onAllocate={(id, share) => void run(() => command({ type: 'allocate', id, share }))} onEffort={(id, effortOverride) => void run(() => command({ type: 'update', id, patch: { effortOverride } }))} /></div>
        </>}
      </section>
      {route.itemId && <><div className="lm-divider" role="separator" aria-label="Resize Item pane" aria-orientation="vertical" tabIndex={0} aria-valuemin={30} aria-valuemax={82} aria-valuenow={paneWidth}
        onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={resize} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={event => { if (event.key === 'ArrowLeft') setPaneWidth(value => Math.min(82, value + 3)); if (event.key === 'ArrowRight') setPaneWidth(value => Math.max(30, value - 3)); }} />
        <section className="lm-detail-pane" aria-label="Item details"><div className="lm-pane-actions"><button onClick={() => navigate({ ...routeRef.current, itemId: null })}>{outline ? '← Outline' : board ? '← Board' : '← Wheel'}</button><div className="lm-pane-actions__right"><button className="lm-expand" onClick={() => setExpanded(value => !value)}>{expanded ? 'Split view' : 'Expand'}</button></div></div>
          {displayed ? <Suspense fallback={<div className="lm-loading">Opening Item…</div>}><ItemPanel settings={settings} propertyId={editPropertyId} key={`${route.snapshotId ?? 'current'}:${displayed.id}`} item={displayed} items={items} showAll={outline ? false : showAll} readOnly={readOnly} snapshotId={route.snapshotId} widgets={workspace.widgets}
            renderWidget={renderWidget} actWidget={actWidget} uploadImage={uploadImage} onOpenItem={select} onCommand={async value => { if (value.type === 'delete' || value.type === 'delete-many') await saveNotes(); await command(value); }} onSelect={select} onNotesChange={changeNotes} notesStatus={noteStatus}
            promptTemplates={workspace.promptTemplates} promptHandling={promptHandling} onSendToAgent={browserDemo ? undefined : sendToAgent} onLaunchT3={browserDemo ? undefined : prompt => launchT3(prompt, t3Location)} /></Suspense> : <div className="lm-empty">This Item is not in this dashboard.</div>}
          {noteStatus === 'Save error' && <button onClick={() => void run(saveNotes)}>Retry saving notes</button>}
        </section></>}
    </div>}
    {resetOpen && !historical && workspace && <Modal error={error} title="Reset properties" onClose={() => !busy && setResetOpen(false)}>
      <PeriodResetForm items={items} settings={settings} busy={busy} onCancel={() => setResetOpen(false)}
        onApply={value => void run(async () => {
          await saveNotes();
          if (routeRef.current.snapshotId) throw new Error('Return to the current period to reset properties.');
          await command(value);
          setResetOpen(false);
        })} />
    </Modal>}
    {contextItem && items.some(item => item.id === contextItem.id) && <ItemContextMenu settings={settings} propertyId={editPropertyId} item={items.find(item => item.id === contextItem.id)!} x={contextItem.x} y={contextItem.y} disabled={readOnly || busy}
      onClose={() => setContextItem(null)} onOpen={() => { select(contextItem.id); setContextItem(null); }}
      onInclude={() => { const item = items.find(item => item.id === contextItem.id)!; setContextItem(null); void run(() => command({type: 'update', id: item.id, patch: {included: !item.included}})); }}
      onMove={() => { setMoveItemId(contextItem.id); setContextItem(null); }}
      canZoom={items.some(item => item.parentId === contextItem.id && (showAll || effectiveIncluded(items, item.id)))}
      onZoom={() => { focus(contextItem.id); setContextItem(null); }}
      onProperty={(propertyId, value) => { const id = contextItem.id; setContextItem(null); void run(() => command({type: 'update', id, patch: propertyPatch(propertyId, value)})); }}
      onStatus={status => { const id = contextItem.id; setContextItem(null); void run(() => command({type: 'update', id, patch: {status}})); }} />}
    {movingItem && <Modal error={error} title={`Move ${movingItem.title}`} onClose={() => !busy && setMoveItemId(null)}>
      <MoveItemForm key={movingItem.id} item={movingItem} items={items} workspaceName={settings.name} disabled={readOnly || busy}
        onCancel={() => setMoveItemId(null)} onMove={parentId => void run(async () => {
          await saveNotes();
          await command({type: 'move', id: movingItem.id, parentId});
          setMoveItemId(null);
        })} />
    </Modal>}
    {rolloverOpen && <Modal error={error} title="New period" onClose={() => !busy && setRolloverOpen(false)}><form onSubmit={event => { event.preventDefault(); void run(async () => { await saveNotes(); await enqueue(async () => accept(await api<Workspace>('rollover', { name: periodName.trim() || undefined, expectedRevision: latest.current!.dashboard.revision }))); setRolloverOpen(false); }); }}>
      <p>Capture this period’s Closing snapshot and carry the dashboard forward unchanged.</p><label>Name<input autoFocus value={periodName} onChange={event => setPeriodName(event.target.value)} placeholder="Optional" maxLength={200} /></label>
      <div className="lm-modal-actions"><button type="button" disabled={busy} onClick={() => setRolloverOpen(false)}>Cancel</button><button className="lm-primary" disabled={busy}>Close and roll over</button></div>
    </form></Modal>}
    {createParent !== undefined && <Modal error={error} title={`Add to ${items.find(item => item.id === createParent)?.title ?? settings.name}`} onClose={() => !busy && setCreateParent(undefined)}>
      <CreateItemForm settings={settings} propertyId={editPropertyId} initialValues={createValues} items={items} parentId={createParent} disabled={busy} onCancel={() => setCreateParent(undefined)}
        onCreate={value => void run(async () => { await command(value); setCreateParent(undefined); })} />
    </Modal>}
    {settingsOpen && <Modal error={error} title="Settings" onClose={() => !busy && setSettingsOpen(false)}>
      <details className="lm-settings-section">
        <summary>Workspace and properties</summary>
        {historical && <p>Return to the current dashboard to change workspace settings.</p>}
        <WorkspaceSettingsEditor settings={settings} items={items} disabled={historical || busy || !workspace} onSave={async (input, original) => {
          await saveNotes();
          await enqueue(async () => {
            const current = latest.current;
            if (!current || current.dashboard.snapshotId) throw new Error('Return to the current dashboard to change workspace settings.');
            if (JSON.stringify(workspaceSettings(current)) !== JSON.stringify(original)) throw new Error('Workspace settings changed elsewhere. Reset changes to load the new configuration.');
            try {accept(await api<Workspace>('settings', {...input, expectedRevision: current.dashboard.revision}));}
            catch (cause) {await refresh(); throw cause;}
          });
        }} />
      </details>
      <details className="lm-settings-section">
        <summary>Top-level Items</summary>
        <RootItemsSettings items={items} disabled={historical || busy || !workspace} onCommand={async value => {await saveNotes(); await command(value);}} onOpen={id => {setSettingsOpen(false); select(id);}} />
      </details>
      <details className="lm-settings-section">
        <summary>Prompts</summary>
        <label>Prompt handling<select value={promptHandling} onChange={event => {
          const value = event.target.value as PromptHandling;
          setPromptHandling(value); savePromptHandling(value);
        }}>
          <option value="modal">Show prompt dialog (default)</option>
          <option value="codex">Codex</option>
          <option value="t3">T3 Code</option>
        </select></label>
        {promptHandling === 't3' && <>
          <label>T3 Code location<input type="text" value={t3Location} maxLength={4096} placeholder="/Applications/T3 Code (Nightly).app" spellCheck={false}
            onChange={event => { setT3Location(event.target.value); saveT3Location(event.target.value); }} /></label>
          <p>Path to the T3 Code app bundle or CLI executable {isDesktopClient() ? 'on this computer' : 'on the Life Manager server'}. Saved automatically for this client. Leave blank to detect automatically.</p>
        </>}
        <p>Saved for this browser or desktop client. Codex opens a draft on this device. T3 Code copies the prompt and opens a blank conversation {isDesktopClient() ? 'on this computer' : 'on the Life Manager server'} for you to paste and submit.</p>
        <form onSubmit={event => { event.preventDefault(); void run(async () => {
          const saved = await api<PromptTemplate>('templates/save', { ...editingTemplate, id: editingTemplate.id || newClientId('prompt') }); setEditingTemplate(saved); await refresh();
        }); }}><label>Template<select aria-label="Edit template" value={editingTemplate.id} onChange={event => setTemplate(event.target.value)}><option value="">New template</option>{workspace?.promptTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <label>Name<input required maxLength={200} value={editingTemplate.name} onChange={event => setEditingTemplate(value => ({ ...value, name: event.target.value }))} /></label>
          <label>Prompt<textarea required rows={8} value={editingTemplate.prompt} onChange={event => setEditingTemplate(value => ({ ...value, prompt: event.target.value }))} /></label>
          <div className="lm-placeholders">{['{{item.name}}', '{{item.url}}', '{{item.id}}'].map(value => <button type="button" key={value} onClick={() => setEditingTemplate(template => ({ ...template, prompt: `${template.prompt}${value}` }))}><code>{value}</code></button>)}</div>
          <div className="lm-modal-actions">{editingTemplate.id && <button type="button" className="lm-danger" disabled={busy} onClick={() => { if (window.confirm(`Delete the “${editingTemplate.name}” prompt template?`)) void run(async () => { await api('templates/delete', { id: editingTemplate.id }); setTemplate(''); await refresh(); }); }}>Delete</button>}<button disabled={busy} className="lm-primary">Save template</button></div>
        </form>
      </details>
      <details className="lm-settings-section">
        <summary>Sunburst display</summary>
        <SunburstDisplaySettings />
      </details>
    </Modal>}
  </main>;
}
