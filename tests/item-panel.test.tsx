// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item, ItemCommand } from '../src/types';
import type { NotesEditorProps } from '../ui/contracts';

vi.mock('../ui/NotesEditor', () => ({
  NotesEditor: ({ value, readOnly, onChange, onOpenItem, uploadImage }: NotesEditorProps) => (
    <div data-testid="notes-editor" data-read-only={String(Boolean(readOnly))} data-upload={String(Boolean(uploadImage))}>
      <div>{value}</div>
      <button type="button" onClick={() => onChange('Changed **notes**')}>Change notes</button>
      <button type="button" onClick={() => onOpenItem('linked')}>Open linked item</button>
    </div>
  ),
}));
import { ItemPanel } from '../ui/ItemPanel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function makeItem(overrides: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return { parentId: null, order: 0, status: 'Later', notes: '', included: true, weight: 1, effortOverride: null, ...overrides };
}
const items: Item[] = [
  makeItem({ id: 'topic', title: 'Build', defaultPromptId: 'resume' }),
  makeItem({ id: 'project', title: 'Life Manager', parentId: 'topic', status: 'Doing', notes: 'Working notes' }),
  makeItem({ id: 'done', title: 'Finished child', parentId: 'project', order: 0, status: 'Done', weight: 3 }),
  makeItem({ id: 'hidden', title: 'Hidden child', parentId: 'project', order: 1, status: 'Skip', included: false, effortOverride: 140 }),
  makeItem({ id: 'grandchild', title: 'Grandchild', parentId: 'done' }),
  makeItem({ id: 'other', title: 'Enjoy', order: 1 }),
];
function renderPanel(overrides: Partial<React.ComponentProps<typeof ItemPanel>> = {}) {
  const props: React.ComponentProps<typeof ItemPanel> = {
    item: items[1]!, items, showAll: false, widgets: [],
    renderWidget: vi.fn().mockResolvedValue({ html: '' }), actWidget: vi.fn().mockResolvedValue({}),
    onOpenItem: vi.fn(), onCommand: vi.fn<(command: ItemCommand) => Promise<void>>().mockResolvedValue(undefined),
    onSelect: vi.fn(), onNotesChange: vi.fn(),
    promptTemplates: [{ id: 'plan', name: 'Plan next steps', prompt: 'Plan for {{id}}' }, { id: 'resume', name: 'Resume work', prompt: 'Resume {{name}}' }],
    onSendToAgent: vi.fn().mockResolvedValue({ message: 'Codex link ready.', url: 'codex://threads/new?prompt=test' }),
    ...overrides,
  };
  return { ...render(<ItemPanel {...props} />), props };
}
async function editNumber(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = screen.getByRole('spinbutton', { name: label });
  await user.clear(input); await user.type(input, value); fireEvent.blur(input);
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
}

describe('ItemPanel', () => {
  it('offers a compact Add child action for leaf Items and reveals a focused, cancellable form', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ item: items[5]! });
    expect(screen.queryByRole('heading', { name: /Children/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'New child title' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ Add child' }));
    const title = screen.getByRole('textbox', { name: 'New child title' });
    expect(document.activeElement).toBe(title);
    await user.type(title, 'Draft{Escape}');
    expect(screen.queryByRole('textbox', { name: 'New child title' })).toBeNull();
    expect(props.onCommand).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '+ Add child' }));
    await user.type(screen.getByRole('textbox', { name: 'New child title' }), 'First child{Enter}');
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'create', parentId: 'other', title: 'First child' });
  });

  it('commits title on blur, keeps status/inclusion independent, and accepts effort above 190%', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const title = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(title); await user.type(title, 'A clearer title');
    expect(props.onCommand).not.toHaveBeenCalled();
    fireEvent.blur(title);
    await waitFor(() => expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'project', patch: { title: 'A clearer title' } }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lifecycle status' }), 'Blocked');
    await user.click(screen.getByRole('checkbox', { name: 'Included on dashboard' }));
    await user.click(screen.getByText('Item settings'));
    await editNumber(user, 'Intended attention percent', '65');
    await editNumber(user, 'Manual effort percent', '275');
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'project', patch: { status: 'Blocked' } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'project', patch: { included: false } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'allocate', id: 'project', share: 65 });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'project', patch: { effortOverride: 275 } });
    expect(screen.getByRole('spinbutton', { name: 'Manual effort percent' }).hasAttribute('max')).toBe(false);
  });

  it('places children before notes and supports child edits, inclusion, bulk actions and accessible reordering', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const children = screen.getByRole('heading', { name: 'Children 2' });
    expect(children.compareDocumentPosition(screen.getByRole('heading', { name: 'Notes' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'New child title' }), 'Next step');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'create', parentId: 'project', title: 'Next step' });
    await user.click(screen.getByRole('button', { name: 'Open Finished child' }));
    expect(props.onSelect).toHaveBeenCalledWith('done');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hidden child lifecycle status' }), 'Now');
    await user.click(screen.getByRole('checkbox', { name: 'Hidden child included on dashboard' }));
    await editNumber(user, 'Finished child allocation percent', '45');
    await editNumber(user, 'Hidden child effort percent', '300');
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'hidden', patch: { status: 'Now' } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'hidden', patch: { included: true } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'allocate', id: 'done', share: 45 });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'hidden', patch: { effortOverride: 300 } });
    await user.click(screen.getByRole('checkbox', { name: 'Select all children' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Selected children status' }), 'Later');
    await user.click(screen.getByRole('button', { name: 'Include' }));
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    await user.click(screen.getByRole('button', { name: 'Clear effort' }));
    await user.click(screen.getByRole('button', { name: 'Hide finished' }));
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'bulk', ids: ['done', 'hidden'], patch: { status: 'Later' } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'bulk', ids: ['done', 'hidden'], patch: { included: true } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'bulk', ids: ['done', 'hidden'], patch: { included: false } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'bulk', ids: ['done', 'hidden'], patch: { effortOverride: null } });
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'bulk', ids: ['done'], patch: { included: false } });
    expect(screen.queryByRole('button', { name: 'Move Hidden child up' })).toBeNull();
  });

  it('renames a child inline on blur or Enter, while the separate open control navigates', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const title = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename Finished child' });
    await user.clear(title);
    await user.type(title, '  Renamed child  ');
    fireEvent.blur(title);
    await waitFor(() => expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'done', patch: { title: 'Renamed child' } }));
    await user.click(screen.getByRole('button', { name: 'Open Finished child' }));
    expect(props.onSelect).toHaveBeenCalledWith('done');
    const hiddenTitle = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename Hidden child' });
    await user.clear(hiddenTitle);
    await user.type(hiddenTitle, 'Renamed with Enter{Enter}');
    await waitFor(() => expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'hidden', patch: { title: 'Renamed with Enter' } }));
  });

  it('still opens a child when clicking its open control commits a pending rename', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const title = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename Finished child' });
    await user.clear(title);
    await user.type(title, 'Rename before opening');
    await user.click(screen.getByRole('button', { name: 'Open Finished child' }));
    expect(props.onSelect).toHaveBeenCalledWith('done');
    await waitFor(() => expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'done', patch: { title: 'Rename before opening' } }));
  });

  it('cancels an inline child rename with Escape and does not save a no-op focus', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const title = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename Finished child' });
    await user.click(title);
    fireEvent.blur(title);
    expect(props.onCommand).not.toHaveBeenCalled();
    await user.click(title);
    await user.clear(title);
    await user.type(title, 'Unsaved name{Escape}');
    expect(title.value).toBe('Finished child');
    expect(props.onCommand).not.toHaveBeenCalled();
  });

  it('keeps a failed child rename draft available for recovery', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn<(command: ItemCommand) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Rename failed'))
      .mockResolvedValue(undefined);
    const { props } = renderPanel({ onCommand });
    const title = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename Finished child' });
    await user.clear(title);
    await user.type(title, 'Recover this name');
    fireEvent.blur(title);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Rename failed'));
    expect(title.value).toBe('Recover this name');
    await user.click(title);
    fireEvent.blur(title);
    await waitFor(() => expect(onCommand).toHaveBeenCalledTimes(2));
  });

  it('confirms bulk deletion including descendants, then clears selection after success', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { props } = renderPanel();
    const remove = screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' });
    expect(remove.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Select all children' }));
    await user.click(remove);
    expect(confirm).toHaveBeenCalledWith('Delete 2 selected children and 1 descendant? Historical snapshots will be preserved.');
    expect(props.onCommand).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(remove);
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'delete-many', ids: ['done', 'hidden'] });
    await waitFor(() => expect(remove.disabled).toBe(true));
  });

  it('confirms deletion from the shared controls, including descendants, and honors cancellation', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { props } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Delete Finished child' }));
    expect(confirm).toHaveBeenCalledWith('Delete “Finished child” and 1 descendant? Historical snapshots will be preserved.');
    expect(props.onCommand).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete Finished child' }));
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'delete', id: 'done' });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete Life Manager' }).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Delete Life Manager' }));
    expect(confirm).toHaveBeenCalledWith('Delete “Life Manager” and 3 descendants? Historical snapshots will be preserved.');
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'delete', id: 'project' });
  });

  it('keeps saving and save errors visible next to the Notes prompt while hiding Saved', () => {
    const { props, rerender } = renderPanel({ notesStatus: 'Saving…' });
    expect(screen.getByText('Saving…').closest('.lm-item-panel__section-heading')).toBeTruthy();
    rerender(<ItemPanel {...props} notesStatus="Save error" />);
    expect(screen.getByText('Save error')).toBeTruthy();
    rerender(<ItemPanel {...props} notesStatus="Saved" />);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('reorders by a touch pointer on the dedicated handle and leaves ordinary rows scrollable', async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    const { props, container } = renderPanel();
    const rows = container.querySelectorAll<HTMLElement>('[data-child-id]');
    rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: index * 60, height: 60 } as DOMRect));
    const handle = screen.getByRole('button', { name: 'Drag to reorder Hidden child' });
    handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn().mockReturnValue(true); handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientY: 90, pointerType: 'touch' });
    fireEvent.pointerMove(handle, { pointerId: 7, clientY: 25, pointerType: 'touch' });
    fireEvent.pointerUp(handle, { pointerId: 7, clientY: 25, pointerType: 'touch' });
    await waitFor(() => expect(props.onCommand).toHaveBeenCalledWith({ type: 'reorder', parentId: 'project', ids: ['hidden', 'done'] }));
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it('excludes descendants from parents and forwards notes, attachments and navigation', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ notesStatus: 'Saved', uploadImage: vi.fn() });
    await user.click(screen.getByText('Item settings'));
    const parent = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Parent item' });
    expect(Array.from(parent.options).map((option) => option.value)).toEqual(['', 'topic', 'other']);
    await user.selectOptions(parent, 'other');
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'move', id: 'project', parentId: 'other' });
    await user.click(screen.getByRole('button', { name: 'Build' }));
    expect(props.onSelect).toHaveBeenCalledWith('topic');
    await user.click(screen.getByRole('button', { name: 'Change notes' }));
    expect(props.onNotesChange).toHaveBeenCalledWith('project', 'Changed **notes**');
    await user.click(screen.getByRole('button', { name: 'Open linked item' }));
    expect(props.onOpenItem).toHaveBeenCalledWith('linked');
    expect(screen.getByTestId('notes-editor').dataset.upload).toBe('true');
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Agent prompt template' }).closest('.lm-item-panel__section-heading')).toBeTruthy();
  });

  it('restores calculated effort explicitly and cancels draft edits with Escape', async () => {
    const user = userEvent.setup();
    const overridden = { ...items[1]!, effortOverride: 275 };
    const { props } = renderPanel({ item: overridden, items: items.map((item) => item.id === overridden.id ? overridden : item) });
    await user.click(screen.getByText('Item settings'));
    await user.clear(screen.getByRole('spinbutton', { name: 'Manual effort percent' }));
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Manual effort percent' }));
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'project', patch: { effortOverride: null } });
    vi.mocked(props.onCommand).mockClear();
    const title = screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' });
    await user.clear(title); await user.type(title, 'Not saved{Escape}');
    expect(title.value).toBe('Life Manager');
    const effort = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Manual effort percent' });
    await user.clear(effort); await user.type(effort, '450{Escape}');
    expect(effort.value).toBe('275');
    expect(props.onCommand).not.toHaveBeenCalled();
  });

  it('inherits the nearest agent default while sending the selected Item, and persists own defaults', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderPanel();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Agent prompt template' }).value).toBe('resume');
    expect(props.onSendToAgent).toHaveBeenCalledWith('project', 'resume');
    expect(props.onCommand).not.toHaveBeenCalled();
    expect((await screen.findByRole('link', { name: 'Resume work' })).getAttribute('href')).toBe('codex://threads/new?prompt=test');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent prompt template' }), 'plan');
    expect(props.onSendToAgent).toHaveBeenLastCalledWith('project', 'plan');
    await user.click(screen.getByText('Item settings'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default agent prompt' }), 'plan');
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'project', patch: { defaultPromptId: 'plan' } });
    const ownDefault = { ...props.item, defaultPromptId: 'plan' };
    rerender(<ItemPanel {...props} item={ownDefault} items={items.map((item) => item.id === ownDefault.id ? ownDefault : item)} />);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Agent prompt template' }).value).toBe('plan');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default agent prompt' }), '');
    expect(props.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'project', patch: { defaultPromptId: null } });
  });

  it('shows link preparation errors without making Item changes', async () => {
    const { props } = renderPanel({ onSendToAgent: vi.fn().mockRejectedValue(new Error('Codex unavailable')) });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Codex unavailable');
    expect(screen.queryByRole('link', { name: 'Resume work' })).toBeNull();
    expect(props.onCommand).not.toHaveBeenCalled();
  });

  it('never exposes a previous prompt link while a new selection is preparing', async () => {
    const user = userEvent.setup();
    let finishFirst!: (reply: { url: string; message: string }) => void;
    const prepare = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValue({ url: 'codex://threads/new?prompt=plan', message: 'Ready' });
    renderPanel({ onSendToAgent: prepare });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent prompt template' }), 'plan');
    const link = await screen.findByRole('link', { name: 'Plan next steps' });
    expect(link.getAttribute('href')).toBe('codex://threads/new?prompt=plan');
    finishFirst({ url: 'codex://threads/new?prompt=resume', message: 'Ready' });
    await waitFor(() => expect(link.getAttribute('href')).toBe('codex://threads/new?prompt=plan'));
  });

  it('allows historical browsing but disables mutation and agent dispatch', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ readOnly: true, snapshotId: 'snapshot-1' });
    expect(screen.getByText('Historical snapshot · read only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByTestId('notes-editor').dataset.readOnly).toBe('true');
    await user.click(screen.getByText('Item settings'));
    for (const element of screen.getAllByRole('spinbutton')) expect((element as HTMLInputElement).disabled).toBe(true);
    for (const name of ['Title', 'New child title', 'Rename Finished child']) expect(screen.getByRole<HTMLInputElement>('textbox', { name }).disabled).toBe(true);
    for (const name of ['Lifecycle status', 'Parent item', 'Agent prompt template', 'Default agent prompt']) expect(screen.getByRole<HTMLSelectElement>('combobox', { name }).disabled).toBe(true);
    for (const name of ['Add', 'Drag to reorder Hidden child']) expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Build' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open Finished child' }).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Open Finished child' }));
    await user.click(screen.getByRole('button', { name: 'Open linked item' }));
    await user.click(screen.getByRole('button', { name: 'Change notes' }));
    expect(props.onSelect).toHaveBeenCalledWith('topic');
    expect(props.onSelect).toHaveBeenCalledWith('done');
    expect(props.onOpenItem).toHaveBeenCalledWith('linked');
    expect(props.onNotesChange).not.toHaveBeenCalled();
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(props.onSendToAgent).not.toHaveBeenCalled();
  });

  it('disables all allocation fields during Show all while retaining effort editing', () => {
    renderPanel({ showAll: true });
    fireEvent.click(screen.getByText('Item settings'));
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Intended attention percent' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Finished child allocation percent' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Manual effort percent' }).disabled).toBe(false);
  });
});

it('clears allocations to automatic mode in both detail and child controls', async () => {
  const user = userEvent.setup();
  const { props, rerender } = renderPanel();
  const child = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Finished child allocation percent' });
  await user.clear(child); fireEvent.blur(child);
  await waitFor(() => expect(props.onCommand).toHaveBeenCalledWith({ type: 'allocate', id: 'done', share: null }));
  const automaticItems = items.map(item => item.id === 'done' ? { ...item, allocationAuto: true } : item);
  rerender(<ItemPanel {...props} items={automaticItems} />);
  expect(child.value).toBe('');
  expect(child.placeholder).toBe('100');
  expect(child.closest('[data-automatic]')?.getAttribute('data-automatic')).toBe('true');
  const allocation = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Intended attention percent' });
  await user.clear(allocation); fireEvent.blur(allocation);
  await waitFor(() => expect(props.onCommand).toHaveBeenCalledWith({ type: 'allocate', id: 'project', share: null }));
});
