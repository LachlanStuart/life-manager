// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { mutateItems } from '../src/domain';
import type { Workspace } from '../src/types';
import type { ItemPanelProps, SunburstProps } from '../ui/contracts';
import { LifeManagerPage } from '../app';
import { parseRoute, routeUrl } from '../ui/navigation';

vi.mock('../ui/Sunburst', () => ({ Sunburst: (props: SunburstProps) => <div>{props.items.map(item => <button key={item.id} onClick={() => props.mode === 'Navigate' || props.mode === 'Omni' ? props.onSelect(item.id) : props.onHighlight?.(item.id)} onContextMenu={event => props.onContextMenu?.(item.id, event.clientX, event.clientY)}>Select {item.title}</button>)}<button onClick={() => props.onFocus('build')}>Focus Build</button><span>Mode {props.mode}</span></div> }));
vi.mock('../ui/ItemPanel', () => ({ ItemPanel: (props: ItemPanelProps) => <div><h2>{props.item.title} details</h2><textarea aria-label="Notes" readOnly={props.readOnly} value={props.item.notes} onChange={event => props.onNotesChange(props.item.id, event.target.value)} /><button disabled={props.readOnly} onClick={() => void props.onCommand({ type: 'update', id: props.item.id, patch: { status: 'Done' } })}>Complete Item</button><button onClick={() => props.onSelect('build')}>Child Build</button>{!props.snapshotId && <button onClick={() => void props.onCommand({ type: 'delete', id: props.item.id })}>Delete</button>}</div> }));
function fixture(): Workspace {
  return { dashboard: { periodId: 'period-1', snapshotId: null, revision: 0, items: [
    { id: 'tend', parentId: null, order: 0, title: 'Tend', status: 'Later', notes: 'Current notes', included: true, weight: 1, effortOverride: null },
    { id: 'build', parentId: null, order: 1, title: 'Build', status: 'Doing', notes: '', included: true, weight: 1, effortOverride: 150 },
  ] }, periods: [{ id: 'period-1', name: 'First period', openedAt: '2026-09-13T00:00:00Z', closedAt: null }],
  snapshots: [{ id: 'opening-1', periodId: 'period-1', kind: 'opening', capturedAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z' }], widgets: [], promptTemplates: [] };
}
function setup(path = '/', extraItems: Workspace['dashboard']['items'] = []) {
  window.history.replaceState(null, '', path);
  let current = fixture(); current.dashboard.items.push(...extraItems); const historical = structuredClone(current); historical.dashboard.snapshotId = 'opening-1'; historical.dashboard.items[0]!.notes = 'Original notes';
  const mutations: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const input = init?.body ? JSON.parse(String(init.body)) : {};
    const state = url.includes('snapshotId=') || input.snapshotId ? historical : current;
    if (url === '/api/mutate') {
      mutations.push(input);
      if (input.expectedRevision !== state.dashboard.revision) return { ok: false, json: async () => ({ error: 'Revision conflict' }) };
      if (input.command.type === 'create' || input.command.type === 'bulk') {
        state.dashboard.items = mutateItems(state.dashboard.items, input.command, state.settings);
      } else if (input.command.type === 'delete') {
        const removed = new Set<string>([input.command.id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const item of state.dashboard.items) {
            if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) { removed.add(item.id); changed = true; }
          }
        }
        state.dashboard.items = state.dashboard.items.filter(item => !removed.has(item.id));
      } else {
        Object.assign(state.dashboard.items.find(item => item.id === input.command.id)!, input.command.patch);
      }
      state.dashboard.revision++;
    } else if (url === '/api/plan') {
      current.snapshots.push({ ...current.snapshots[0]!, id: 'planned-1', kind: 'planned' }); current.dashboard.revision++;
    } else if (url === '/api/rollover') {
      current.dashboard.periodId = 'period-2'; current.dashboard.revision++;
      current.periods.push({ id: 'period-2', name: input.name || 'Next period', openedAt: '2026-09-14T00:00:00Z', closedAt: null });
    }
    return { ok: true, json: async () => structuredClone(state) };
  }));
  return { screen: render(<LifeManagerPage />), current, historical, mutations };
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal('PointerEvent', MouseEvent); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; });

it('defaults prompt handling to the copy dialog and remembers the choice in this client', async () => {
  const { screen, mutations } = setup();
  await screen.findByText('Select Tend');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByText('Prompts', { selector: 'summary' }));
  const select = screen.getByRole('combobox', { name: 'Prompt handling' }) as HTMLSelectElement;
  expect(select.value).toBe('modal');
  fireEvent.change(select, { target: { value: 'codex' } });
  expect(localStorage.getItem('life-manager.prompt-handling')).toBe('codex');
  expect(mutations).toEqual([]);
  cleanup();
  const next = setup().screen;
  await next.findByText('Select Tend');
  fireEvent.click(next.getByRole('button', { name: 'Settings' }));
  fireEvent.click(next.getByText('Prompts', { selector: 'summary' }));
  expect((next.getByRole('combobox', { name: 'Prompt handling' }) as HTMLSelectElement).value).toBe('codex');
});

it('persists the T3 installation location across client restarts', async () => {
  const { screen } = setup();
  await screen.findByText('Select Tend');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByText('Prompts', { selector: 'summary' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt handling' }), { target: { value: 't3' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'T3 Code location' }), { target: { value: '/Applications/T3 Code (Nightly).app' } });
  expect(localStorage.getItem('life-manager.t3-location')).toBe('/Applications/T3 Code (Nightly).app');
  cleanup();
  const next = setup().screen;
  await next.findByText('Select Tend');
  fireEvent.click(next.getByRole('button', { name: 'Settings' }));
  fireEvent.click(next.getByText('Prompts', { selector: 'summary' }));
  expect((next.getByRole('textbox', { name: 'T3 Code location' }) as HTMLInputElement).value).toBe('/Applications/T3 Code (Nightly).app');
  fireEvent.change(next.getByRole('textbox', { name: 'T3 Code location' }), { target: { value: '' } });
  expect(localStorage.getItem('life-manager.t3-location')).toBe('');
});

it('confirms period resets once for all Items, including hidden descendants, and preserves snapshots', async () => {
  const { screen, current, historical, mutations } = setup('/', [
    { id: 'hidden', parentId: 'build', order: 0, title: 'Hidden child', status: 'Done', notes: 'Keep notes', included: false, weight: 1, effortOverride: 60 },
  ]);
  await screen.findByText('Select Tend');
  const before = structuredClone(historical);
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard period' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset properties…' }));
  expect(screen.getByRole('dialog', { name: 'Reset properties' })).toBeTruthy();
  expect(mutations).toHaveLength(0);
  fireEvent.click(screen.getByLabelText('Set Status to'));
  fireEvent.click(screen.getByRole('button', { name: 'Apply resets to 3 Items' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reset properties' })).toBeNull());
  expect(mutations).toHaveLength(1);
  expect(current.dashboard.items.every(item => item.allocationAuto && item.effortOverride === null && item.status === 'Later')).toBe(true);
  expect(current.dashboard.items.find(item => item.id === 'hidden')).toMatchObject({ included: false, notes: 'Keep notes', parentId: 'build' });
  expect(historical).toEqual(before);
});

it('discards reset selections on Cancel or Escape and reopens with checked Auto defaults', async () => {
  const { screen, mutations } = setup();
  await screen.findByText('Select Tend');
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard period' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset properties…' }));
  };
  open();
  fireEvent.click(screen.getByLabelText('Return effort to Auto'));
  fireEvent.click(screen.getByLabelText('Set Status to'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  open();
  expect((screen.getByLabelText('Return effort to Auto') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Set Status to') as HTMLInputElement).checked).toBe(false);
  fireEvent(screen.getByRole('dialog', { name: 'Reset properties' }), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog', { name: 'Reset properties' })).toBeNull();
  expect(mutations).toHaveLength(0);
});

it('keeps the reset dialog open on failure and disables reset in historical views', async () => {
  const { screen } = setup();
  await screen.findByText('Select Tend');
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard period' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset properties…' }));
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Reset failed' }) } as Response);
  fireEvent.click(screen.getByRole('button', { name: 'Apply resets to 2 Items' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Apply resets to 2 Items' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole('dialog', { name: 'Reset properties' }).textContent).toContain('Reset failed');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard period' }));
  fireEvent.click(screen.getByRole('button', { name: /Opening/ }));
  await waitFor(() => expect(window.location.search).toBe('?snapshot=opening-1'));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Dashboard period' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard period' }));
  expect((screen.getByRole('button', { name: 'Reset properties…' }) as HTMLButtonElement).disabled).toBe(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('standalone workspace', () => {
  it('opens home as the wheel and keeps mode selection from opening an Item', async () => {
    const { screen, mutations } = setup(); await screen.findByText('Select Tend');
    expect(screen.queryByLabelText('Item details')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Importance'})); fireEvent.click(screen.getByText('Select Tend'));
    expect(screen.queryByLabelText('Item details')).toBeNull(); expect(mutations).toHaveLength(0);
    fireEvent.click(screen.getByText('Navigate')); fireEvent.click(screen.getByText('Select Tend'));
    await screen.findByText('Tend details'); expect(window.location.pathname).toBe('/items/tend');
  });
  it('flushes the old Item draft before navigation and serializes its revision with status changes', async () => {
    const { screen, current, mutations } = setup('/items/tend'); await screen.findByText('Tend details');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '**Resume here**' } });
    fireEvent.click(screen.getByText('Complete Item')); fireEvent.click(screen.getByText('Child Build'));
    await screen.findByText('Build details');
    expect(current.dashboard.items[0]).toMatchObject({ notes: '**Resume here**', status: 'Done' });
    expect(mutations.map(value => value.expectedRevision)).toEqual([0, 1]);
    expect(window.location.pathname).toBe('/items/build');
  });
  it('keeps snapshot corrections isolated and notes read-only until explicitly enabled', async () => {
    const { screen, current, historical } = setup('/items/tend?snapshot=opening-1'); await screen.findByText('Tend details');
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.click(screen.getByText('Correct this snapshot'));
    await waitFor(() => expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).readOnly).toBe(false));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Correction' } }); fireEvent.click(screen.getByText('Finish correction'));
    await waitFor(() => expect(historical.dashboard.items[0]!.notes).toBe('Correction'));
    expect(current.dashboard.items[0]!.notes).toBe('Current notes');
  });
  it('flushes notes before deleting and preserves the historical descendants', async () => {
    const base = fixture().dashboard.items[0]!;
    const extra = [
      { ...base, id: 'tend-child', title: 'Child', parentId: 'tend', order: 2 },
      { ...base, id: 'tend-grandchild', title: 'Grandchild', parentId: 'tend-child', order: 3 },
    ];
    const { screen, current, historical, mutations } = setup('/items/tend', extra);
    await screen.findByText('Tend details');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Saved before deletion' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Tend details')).toBeNull());
    expect(mutations.map(value => value.command.type)).toEqual(['update', 'delete']);
    expect(mutations[0]?.command.patch.notes).toBe('Saved before deletion');
    expect(current.dashboard.items.map(item => item.id)).toEqual(['build']);
    expect(historical.dashboard.items.map(item => item.id)).toContain('tend-grandchild');
    expect(window.location.pathname).toBe('/');
    confirm.mockRestore();
  });
  it('keeps Delete hidden for every historical snapshot, including correction mode', async () => {
    const { screen } = setup('/items/tend?snapshot=opening-1');
    await screen.findByText('Tend details');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(screen.getByText('Correct this snapshot'));
    await waitFor(() => expect(screen.getByText('Finish correction')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
  it('preserves wheel focus in URL when navigating and responding to browser Back', async () => {
    const { screen } = setup('/?focus=build'); await screen.findByText('Select Tend');
    fireEvent.click(screen.getByText('Select Tend')); await screen.findByText('Tend details');
    expect(window.location.search).toBe('?focus=build');
    window.history.replaceState(null, '', '/?focus=build'); fireEvent.popState(window);
    await waitFor(() => expect(screen.queryByLabelText('Item details')).toBeNull());
  });
  it('captures planning and rolls over with effort/status unchanged', async () => {
    const { screen, current } = setup(); await screen.findByText('Select Tend');
    expect(screen.queryByRole('button', {name: 'Planning is finished'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Dashboard period'}));
    fireEvent.click(screen.getByRole('button', {name: 'Planning is finished'})); await waitFor(() => expect((screen.getByRole('button', {name: 'Planning is finished'}) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', {name: 'Roll over'})); fireEvent.click(screen.getByText('Close and roll over'));
    await waitFor(() => expect(current.dashboard.periodId).toBe('period-2'));
    expect(current.dashboard.items[1]).toMatchObject({ status: 'Doing', effortOverride: 150 });
  });
  it('Show all changes display only', async () => {
    const { screen, mutations } = setup(); await screen.findByText('Select Tend');
    fireEvent.click(screen.getByLabelText('Show all')); expect(mutations).toHaveLength(0);
  });
  it('keeps Kanban in navigation and returns from an Item to the board', async () => {
    const { screen, mutations } = setup('/?view=kanban');
    await screen.findByLabelText('Kanban board');
    fireEvent.click(screen.getByRole('button', { name: 'Tend, Later' }));
    await screen.findByText('Tend details');
    expect(window.location.search).toBe('?view=kanban');
    fireEvent.click(screen.getByRole('button', { name: '← Board' }));
    await waitFor(() => expect(screen.queryByLabelText('Item details')).toBeNull());
    fireEvent.click(screen.getByText('Focus Build'));
    await waitFor(() => expect(window.location.search).toBe('?focus=build&view=kanban'));
    fireEvent.click(screen.getByRole('button', { name: 'Sunburst' }));
    await waitFor(() => expect(window.location.search).toBe('?focus=build'));
    expect(screen.queryByLabelText('Kanban board')).toBeNull();
    expect(mutations).toHaveLength(0);
  });

  it('shows ancestor links and only child branches, with Open beside the current Item', async () => {
    const base = fixture().dashboard.items[0]!;
    const extra = [
      { ...base, id: 'learn', title: 'Learn', parentId: null },
      ...['DE', 'FR', 'JP', 'ZH', 'Other', 'Culture'].map((title, order) => ({ ...base, id: title, title, order, parentId: 'learn' })),
      ...['DE', 'FR', 'JP', 'Other', 'Culture'].map(title => ({ ...base, id: `${title}-child`, title: 'Study', parentId: title })),
    ];
    const { screen } = setup('/?view=kanban&focus=learn', extra);
    await screen.findByLabelText('Focus branch');
    const nav = screen.getByLabelText('Focus branch');
    expect(Array.from(nav.querySelectorAll('button')).map(button => button.textContent)).toEqual(['↑ Life', 'Learn', 'Open', 'DE', 'FR', 'JP', 'Other', 'Culture']);
    fireEvent.click(Array.from(nav.querySelectorAll('button')).find(button => button.textContent === 'DE')!);
    await waitFor(() => expect(window.location.search).toBe('?focus=DE&view=kanban'));
    expect(Array.from(nav.querySelectorAll('button')).map(button => button.textContent)).toEqual(['↑ Life', '↑ Learn', 'DE', 'Open']);
    fireEvent.click(Array.from(nav.querySelectorAll('button')).find(button => button.textContent === 'Open')!);
    await screen.findByText('DE details');
    expect(window.location.pathname).toBe('/items/DE');
    expect(document.querySelector('.lm-period-controls')?.firstElementChild?.getAttribute('aria-label')).toBe('Dashboard view');
  });

  it('round-trips deep links without a separate session state', () => {
    const route = { itemId: 'a/b', focusId: 'one two', snapshotId: 'opening', view: 'kanban' as const };
    expect(parseRoute(new URL(routeUrl(route), 'http://localhost'))).toEqual(route);
  });
});

it.each([true, false])('defaults to Omni only with a desktop pointer (%s)', async desktop => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const { screen } = setup();
  await screen.findByText(`Mode ${desktop ? 'Omni' : 'Navigate'}`);
});

it.each(['/', '/?view=kanban'])('dismisses details only for a background click, preserving drafts (%s)', async path => {
  const {screen, current} = setup(path);
  await screen.findByText('Select Tend');
  fireEvent.click(path.includes('kanban') ? screen.getByRole('button', {name: 'Tend, Later'}) : screen.getByText('Select Tend'));
  await screen.findByText('Tend details');
  fireEvent.change(screen.getByLabelText('Notes'), {target: {value: 'Keep my draft'}});
  const background = screen.getByLabelText('Attention dashboard');
  fireEvent.pointerDown(background, {clientX: 20, clientY: 20});
  fireEvent.click(background, {clientX: 20, clientY: 20});
  await waitFor(() => expect(screen.queryByLabelText('Item details')).toBeNull());
  expect(current.dashboard.items[0]!.notes).toBe('Keep my draft');
});

it('changes status directly from the wheel menu without opening details', async () => {
  const {screen, current} = setup(); await screen.findByText('Select Tend');
  fireEvent.contextMenu(screen.getByText('Select Tend'), {clientX: 100, clientY: 100});
  fireEvent.click(screen.getByRole('menuitemradio', {name: 'Now'}));
  await waitFor(() => expect(current.dashboard.items[0]!.status).toBe('Now'));
  expect(screen.queryByLabelText('Item details')).toBeNull();
  expect(screen.queryByRole('menu')).toBeNull();
});

it('allows mobile Omni and starts both settings sections closed', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()})));
  const {screen} = setup(); await screen.findByText('Mode Navigate');
  fireEvent.click(screen.getByRole('button', {name: 'Omni'}));
  await screen.findByText('Mode Omni');
  fireEvent.click(screen.getByRole('button', {name: 'Settings'}));
  expect(Array.from(screen.getByRole('dialog').querySelectorAll('details')).every(details => !details.open)).toBe(true);
});

it('opens historical snapshots from the period picker', async () => {
  const {screen} = setup('/items/tend'); await screen.findByText('Tend details');
  fireEvent.click(screen.getByRole('button', {name: 'Dashboard period'}));
  fireEvent.click(screen.getByRole('button', {name: /^Opening/}));
  await waitFor(() => expect(window.location.search).toBe('?snapshot=opening-1'));
  await waitFor(() => expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Original notes'));
});

it.each(['', '?view=kanban'])('does not dismiss details for card clicks or background drags (%s)', async query => {
  const {screen} = setup(`/items/tend${query}`); await screen.findByText('Tend details');
  const background = screen.getByLabelText('Attention dashboard');
  fireEvent.pointerDown(background, {clientX: 20, clientY: 20});
  fireEvent.click(background, {clientX: 20, clientY: 120});
  expect(screen.getByText('Tend details')).toBeTruthy();
  const next = query ? screen.getByRole('button', {name: 'Build, Doing'}) : screen.getByText('Select Build');
  const navigation = vi.spyOn(window.history, 'pushState');
  fireEvent.pointerDown(next, {clientX: 20, clientY: 20}); fireEvent.click(next);
  await screen.findByText('Build details');
  expect(navigation).toHaveBeenCalledTimes(1);
  expect(window.location.pathname).toBe('/items/build');
  navigation.mockRestore();
});

it.each([['kanban', null], ['kanban', 'tend'], ['sunburst', null], ['sunburst', 'tend']])('creates %s Items under the current scope (%s)', async (view, focus) => {
  const {screen, current} = setup(`/?${view === 'kanban' ? 'view=kanban&' : ''}${focus ? 'focus=' + focus : ''}`);
  await screen.findByText('Select Tend');
  fireEvent.click(screen.getByRole('button', {name: '+ New'}));
  await screen.findByRole('dialog', {name: focus ? 'Add to Tend' : 'Add to Life'});
  fireEvent.change(screen.getByLabelText('Title'), {target: {value: 'New board task'}});
  fireEvent.click(screen.getByRole('button', {name: 'Create Item'}));
  await waitFor(() => expect(current.dashboard.items.find(item => item.title === 'New board task')).toMatchObject({parentId: focus, allocationAuto: true}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it.each(['kanban', 'sunburst'])('disables %s creation in historical snapshots', async view => {
  const {screen} = setup(`/?${view === 'kanban' ? 'view=kanban&' : ''}snapshot=opening-1`); await screen.findByText('Select Tend');
  expect((screen.getByRole('button', {name: '+ New'}) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps sort overrides separate for each view without writing dashboard data', async () => {
  const {screen, mutations} = setup(); await screen.findByText('Select Tend');
  fireEvent.change(screen.getByLabelText('Sort current view'), {target: {value: 'Effort'}});
  fireEvent.click(screen.getByRole('button', {name: 'Kanban'}));
  await screen.findByLabelText('Kanban board');
  expect((screen.getByLabelText('Sort current view') as HTMLSelectElement).value).toBe('Order');
  fireEvent.change(screen.getByLabelText('Sort current view'), {target: {value: 'Importance'}});
  fireEvent.click(screen.getByRole('button', {name: 'Sunburst'}));
  await screen.findByText('Select Tend');
  expect((screen.getByLabelText('Sort current view') as HTMLSelectElement).value).toBe('Effort');
  expect(mutations).toHaveLength(0);
});

it('flushes pending notes before the desktop disconnects, and reports save failures', async () => {
  const { screen, current } = setup('/items/tend');
  await screen.findByLabelText('Notes');
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Save before quitting' } });
  await window.lifeManagerFlush!();
  expect(current.dashboard.items[0]!.notes).toBe('Save before quitting');
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Keep this failed draft' } });
  vi.mocked(fetch).mockImplementationOnce(async () => { throw new Error('Server unavailable'); });
  await expect(window.lifeManagerFlush!()).rejects.toThrow('Server unavailable');
  expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Keep this failed draft');
});
