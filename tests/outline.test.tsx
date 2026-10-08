// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { Outline } from '../ui/Outline';
import { DEFAULT_WORKSPACE_SETTINGS as settings } from '../src/properties';
import { mutateItems } from '../src/domain';
import type { Item, ItemCommand } from '../src/types';
import type { ViewSort } from '../ui/view-sort';

const item = (id: string, parentId: string | null, extra: Partial<Item> = {}): Item => ({ id, title: id, parentId, order: 0, status: 'Later', notes: '', included: true, weight: 1, allocationAuto: true, effortOverride: null, ...extra });
const fixture = () => [item('Build', null), item('Garden', 'Build'), item('Sketch', 'Garden'), item('Test', 'Garden', { order: 1 }), item('Learn', null, { order: 1, included: false }), item('Japanese', 'Learn')];
function setup({ disabled = false, historical = false, sort = 'Order' as ViewSort, reject = false, matchingIds = undefined as ReadonlySet<string> | undefined } = {}) {
  const commands: ItemCommand[] = [];
  let current = fixture();
  const open = vi.fn();
  function Harness() {
    const [items, setItems] = useState(current);
    const [active, setActive] = useState(true);
    return <><button onClick={() => setActive(value => !value)}>Switch view</button><Outline matchingIds={matchingIds} items={items} settings={settings} propertyId="status" sort={sort} selectedId={null} disabled={disabled} historical={historical} revision={commands.length} active={active} onOpen={open}
      onCommand={async command => { if (reject) throw new Error('Revision conflict'); current = mutateItems(current, command, settings); commands.push(command); setItems(current); }} /></>;
  }
  const screen = render(<Harness />);
  return { screen, commands, open, current: () => current };
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('starts at two levels, distinguishes inherited hiding, and preserves expansion between views', () => {
  const { screen, commands } = setup();
  expect(screen.queryByRole('treeitem', { name: 'Sketch' })).toBeNull();
  const hiddenRow = screen.getByRole('treeitem', { name: 'Japanese' });
  expect(hiddenRow.getAttribute('data-hidden')).toBe('true');
  expect(within(hiddenRow).queryByText('Hidden by parent')).toBeNull();
  expect(within(hiddenRow).getByTitle('Hidden by parent')).toBeTruthy();
  expect(hiddenRow.style.getPropertyValue('--lm-row-color')).toBe('#7b8178');
  expect((screen.getByLabelText('Japanese included on dashboard') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Expand Garden' }));
  expect(screen.getByRole('treeitem', { name: 'Sketch' })).toBeTruthy();
  fireEvent.click(screen.getByText('Switch view')); fireEvent.click(screen.getByText('Switch view'));
  expect(screen.getByRole('treeitem', { name: 'Sketch' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Outline visibility'), { target: { value: 'dashboard' } });
  expect(screen.queryByRole('treeitem', { name: 'Japanese' })).toBeNull();
  expect(commands).toEqual([]);
});

it('search reveals matching descendants with ancestors and restores prior collapse on clearing', () => {
  const { screen } = setup();
  fireEvent.change(screen.getByLabelText('Find in outline'), { target: { value: 'Sketch' } });
  expect(screen.getAllByRole('treeitem').map(row => row.getAttribute('aria-label'))).toEqual(['Build', 'Garden', 'Sketch']);
  fireEvent.change(screen.getByLabelText('Find in outline'), { target: { value: '' } });
  expect(screen.queryByRole('treeitem', { name: 'Sketch' })).toBeNull();
});

it('edits titles, cancels Escape, and changes inclusion without navigation', async () => {
  const { screen, commands, open } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Garden' }));
  fireEvent.change(screen.getByLabelText('Rename Garden'), { target: { value: 'Herbs' } });
  fireEvent.keyDown(screen.getByLabelText('Rename Garden'), { key: 'Escape' });
  expect(commands).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Garden' }));
  fireEvent.change(screen.getByLabelText('Rename Garden'), { target: { value: 'Herbs' } });
  fireEvent.blur(screen.getByLabelText('Rename Garden'));
  await waitFor(() => expect(commands).toHaveLength(1));
  await waitFor(() => expect((screen.getByLabelText('Herbs included on dashboard') as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getByLabelText('Herbs included on dashboard'));
  await waitFor(() => expect(commands).toHaveLength(2));
  expect(open).not.toHaveBeenCalled();
});

it('adds successive children at the chosen parent and retains defaults', async () => {
  const { screen, current } = setup();
  fireEvent.click(screen.getByLabelText('Add child to Garden'));
  const input = screen.getByLabelText('New Item under Garden');
  fireEvent.change(input, { target: { value: 'Choose pots' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  fireEvent.change(input, { target: { value: 'Buy seeds' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(current().filter(item => item.parentId === 'Garden')).toHaveLength(4));
  expect(current().find(item => item.title === 'Buy seeds')).toMatchObject({ included: true, allocationAuto: true, effortOverride: null, status: 'Later' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByLabelText('New Item under Garden')).toBeNull();
});

it('selects only the row by default and supports explicit branch selection and bulk Auto', async () => {
  const { screen, commands } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByLabelText('Select Garden'));
  fireEvent.click(screen.getByLabelText('Bulk actions'));
  fireEvent.click(screen.getByRole('button', { name: 'Exclude' }));
  await waitFor(() => expect(commands[0]).toEqual({ type: 'bulk', ids: ['Garden'], patch: { included: false } }));
  const actions = screen.getByLabelText('Actions for Garden'); fireEvent.click(actions);
  fireEvent.click(within(actions.parentElement!).getByText('Select branch'));
  fireEvent.click(screen.getByLabelText('Bulk actions'));
  fireEvent.click(screen.getByText('Effort to Auto'));
  await waitFor(() => expect(commands[1]).toEqual({ type: 'bulk', ids: ['Garden', 'Sketch', 'Test'], patch: { effortOverride: null } }));
});

it('moves through the searchable picker, preserves children, and undoes placement', async () => {
  const { screen, current } = setup();
  fireEvent.click(screen.getByLabelText('Actions for Garden'));
  fireEvent.click(within(screen.getByLabelText('Actions for Garden').parentElement!).getByText('Move to…'));
  const dialog = screen.getByRole('dialog', { name: 'Move Garden' });
  expect(within(dialog).queryByRole('option', { name: /Sketch/ })).toBeNull();
  fireEvent.change(within(dialog).getByLabelText('Find a destination'), { target: { value: 'Japanese' } });
  fireEvent.change(within(dialog).getByLabelText('Move to'), { target: { value: 'Japanese' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
  await waitFor(() => expect(current().find(item => item.id === 'Garden')?.parentId).toBe('Japanese'));
  expect(current().find(item => item.id === 'Sketch')?.parentId).toBe('Garden');
  await waitFor(() => expect((screen.getByText('Undo move') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Undo move'));
  await waitFor(() => expect(current().find(item => item.id === 'Garden')?.parentId).toBe('Build'));
});

it.each(['inside', 'before', 'after'] as const)('drags to %s a row with a clear target', async position => {
  const { screen, current } = setup();
  const target = screen.getByRole('treeitem', { name: 'Learn' });
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140, height: 40, left: 0, right: 800, width: 800, x: 0, y: 100, toJSON() {} });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  const grip = screen.getByLabelText('Drag Garden');
  fireEvent.pointerDown(grip, { button: 0, clientX: 40, clientY: 40 });
  fireEvent.pointerMove(grip, { clientX: 100, clientY: position === 'before' ? 102 : position === 'after' ? 138 : 120 });
  expect(target.getAttribute('data-drop')).toBe(position);
  fireEvent.pointerUp(grip);
  await waitFor(() => expect(current().find(item => item.id === 'Garden')?.parentId).toBe(position === 'inside' ? 'Learn' : null));
  if (position !== 'inside') {
    const garden = current().find(item => item.id === 'Garden')!, learn = current().find(item => item.id === 'Learn')!;
    expect(position === 'before' ? garden.order < learn.order : garden.order > learn.order).toBe(true);
  }
});

it('rejects a drag into a descendant and cancels a drag on Escape', () => {
  const { screen, commands } = setup();
  const target = screen.getByRole('treeitem', { name: 'Garden' });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  const grip = screen.getByLabelText('Drag Build');
  fireEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(grip, { clientX: 50, clientY: 50 });
  expect(target.hasAttribute('data-drop')).toBe(false);
  fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.pointerUp(grip);
  expect(commands).toEqual([]);
});

it('retains a failed creation draft and shows the save error', async () => {
  const { screen } = setup({ reject: true });
  fireEvent.click(screen.getByLabelText('Add child to Garden'));
  const input = screen.getByLabelText('New Item under Garden');
  fireEvent.change(input, { target: { value: 'Retry this' } }); fireEvent.submit(input.closest('form')!);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Revision conflict');
  expect((input as HTMLInputElement).value).toBe('Retry this');
});

it('keeps historical snapshots navigable and read only', () => {
  const { screen, commands, open } = setup({ disabled: true, historical: true });
  expect((screen.getByLabelText('Garden included on dashboard') as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByLabelText('Delete Garden')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand Garden' }));
  fireEvent.click(screen.getByLabelText('Open Sketch'));
  expect(open).toHaveBeenCalledWith('Sketch');
  expect(commands).toEqual([]);
});

it('keeps allocation editable in All Items and keyboard expansion independent of inclusion', async () => {
  const { screen, commands } = setup();
  const allocation = screen.getByLabelText('Garden allocation percent') as HTMLInputElement;
  expect(allocation.disabled).toBe(false);
  const row = screen.getByRole('treeitem', { name: 'Garden' });
  row.focus(); fireEvent.keyDown(row, { key: 'ArrowRight' });
  expect(screen.getByRole('treeitem', { name: 'Sketch' })).toBeTruthy();
  fireEvent.keyDown(row, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Sketch' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(row);
  expect(commands).toEqual([]);
  fireEvent.focus(allocation); fireEvent.change(allocation, { target: { value: '100' } }); fireEvent.blur(allocation);
  await waitFor(() => expect(commands[0]).toEqual({ type: 'allocate', id: 'Garden', share: 100 }));
});

it('does not imply sibling reordering while a sort override is active', async () => {
  const { screen, commands } = setup({ sort: 'Importance' });
  const target = screen.getByRole('treeitem', { name: 'Learn' });
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140, height: 40, left: 0, right: 800, width: 800, x: 0, y: 100, toJSON() {} });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  const grip = screen.getByLabelText('Drag Garden');
  fireEvent.pointerDown(grip, { button: 0, clientX: 40, clientY: 40 });
  fireEvent.pointerMove(grip, { clientX: 100, clientY: 102 });
  expect(target.getAttribute('data-drop')).toBe('inside');
  fireEvent.pointerUp(grip);
  await waitFor(() => expect(commands[0]).toEqual({ type: 'arrange', ids: ['Garden'], parentId: 'Learn' }));
});


it('keeps filtered ancestors as context and applies bulk actions only to matching rows', async () => {
  const {screen, commands} = setup({matchingIds: new Set(['Sketch'])});
  expect(screen.getAllByRole('treeitem').map(row => row.getAttribute('aria-label'))).toEqual(['Build', 'Garden', 'Sketch']);
  expect(screen.getByRole('treeitem', {name: 'Garden'}).getAttribute('data-context')).toBe('true');
  fireEvent.click(screen.getByRole('button', {name: 'Select'}));
  expect((screen.getByLabelText('Select Garden') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', {name: 'Select shown rows'}));
  fireEvent.click(screen.getByLabelText('Bulk actions'));
  fireEvent.click(screen.getByRole('button', {name: 'Exclude'}));
  await waitFor(() => expect(commands[0]).toEqual({type: 'bulk', ids: ['Sketch'], patch: {included: false}}));
});


it('keeps selection actions in a dismissible bottom bar and omits the persistent footer', () => {
  const { screen } = setup();
  expect(screen.queryByRole('toolbar', { name: 'Selected Item actions' })).toBeNull();
  expect(screen.queryByText(/Allocation =/)).toBeNull();
  expect(screen.queryByText(/shown ·/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  const toolbar = screen.getByRole('toolbar', { name: 'Selected Item actions' });
  expect(screen.getByRole('tree').compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect((screen.getByLabelText('Bulk actions').parentElement as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(screen.getByLabelText('Bulk actions'));
  expect((screen.getByLabelText('Bulk actions').parentElement as HTMLDetailsElement).open).toBe(true);
  fireEvent.keyDown(screen.getByLabelText('Bulk actions'), { key: 'Escape' });
  expect((screen.getByLabelText('Bulk actions').parentElement as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(screen.getByLabelText('Bulk actions'));
  fireEvent.pointerDown(screen.getByRole('tree'));
  expect((screen.getByLabelText('Bulk actions').parentElement as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  expect(screen.queryByRole('toolbar', { name: 'Selected Item actions' })).toBeNull();
});
