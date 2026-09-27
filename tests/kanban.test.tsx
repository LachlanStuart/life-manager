// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Status } from '../src/types';
import Kanban from '../ui/Kanban';
import {
  branchRelativeShares,
  buildKanbanModel,
  kanbanItems,
  reorderedSiblingIds,
} from '../ui/kanban-helpers';

function item(
  id: string,
  parentId: string | null,
  options: Partial<Pick<Item, 'order' | 'weight' | 'included' | 'status' | 'title'>> = {},
): Item {
  return {
    id,
    parentId,
    order: options.order ?? (Number(id.replace(/\D/g, '')) || 0),
    title: options.title ?? id,
    status: options.status ?? 'Later',
    notes: '',
    included: options.included ?? true,
    weight: options.weight ?? 1,
    effortOverride: null,
  };
}

const branchItems: Item[] = [
  item('root', null, { title: 'Build', weight: 3 }),
  item('other', null, { title: 'Tend', order: 1, weight: 1 }),
  item('a', 'root', { title: 'Alpha', order: 0, weight: 1, status: 'Now' }),
  item('b', 'root', { title: 'Beta', order: 1, weight: 3, status: 'Later' }),
  item('hidden', 'root', { title: 'Hidden', order: 2, weight: 20, included: false, status: 'Done' }),
  item('nested', 'a', { title: 'Nested', order: 0, weight: 1, status: 'Doing' }),
  item('nested-hidden', 'a', { title: 'Nested hidden', order: 1, weight: 1, included: false }),
];

let originalElementFromPoint: typeof document.elementFromPoint;

beforeEach(() => { originalElementFromPoint = document.elementFromPoint; });
afterEach(() => {
  cleanup();
  if (originalElementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
  } else {
    delete (document as unknown as { elementFromPoint?: typeof document.elementFromPoint }).elementFromPoint;
  }
});

function pointTarget(target: Element | null) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => target),
  });
}

function dragFromTo(handle: HTMLElement, target: Element | null, pointerId = 7, clientY = 1, clientX = 10) {
  pointTarget(target);
  fireEvent.pointerDown(handle, { button: 0, pointerId, clientX: clientX - 15, clientY });
  fireEvent.pointerMove(handle, { pointerId, clientX, clientY });
  fireEvent.pointerUp(handle, { pointerId, clientX, clientY });
}


describe('kanban model', () => {
  it('shows the deepest included work, excluding parents and the focus itself', () => {
    expect(kanbanItems(branchItems, 'root').map((entry) => entry.id)).toEqual(['nested', 'b']);
    expect(kanbanItems(branchItems, null).map((entry) => entry.id)).toEqual(['nested', 'b', 'other']);
  });

  it('restores a parent card when its last included child is hidden', () => {
    const deferred = branchItems.map((entry) => entry.id === 'nested' ? { ...entry, included: false } : entry);
    expect(kanbanItems(deferred, 'root').map((entry) => entry.id)).toEqual(['a', 'b']);
    const hiddenParent = branchItems.map((entry) => entry.id === 'a' ? { ...entry, included: false } : entry);
    expect(kanbanItems(hiddenParent, 'root').map((entry) => entry.id)).toEqual(['b']);
  });

  it('uses inclusion rather than status or weight to suppress parent cards', () => {
    const finished = branchItems.map((entry) => entry.id === 'nested' ? { ...entry, status: 'Done' as const, weight: 0 } : entry);
    expect(kanbanItems(finished, 'root').map((entry) => entry.id)).toEqual(['nested', 'b']);
  });

  it('calculates a product of local allocations for deeper cards', () => {
    const shares = branchRelativeShares(branchItems, 'root');
    expect(shares.get('a')).toBeCloseTo(.25);
    expect(shares.get('b')).toBeCloseTo(.75);
    expect(shares.get('nested')).toBeCloseTo(.25);
  });

  it('keeps requested status order and visually groups cards by their immediate parent path', () => {
    const model = buildKanbanModel(branchItems, 'root');
    expect(model.columns.map((column) => column.status)).toEqual(['Now', 'Doing', 'Blocked', 'Done', 'Later', 'Skip', 'Cut']);
    expect(model.columns[0]?.groups).toEqual([]);
    expect(model.columns[1]?.groups[0]?.parentPath.map((entry) => entry.title)).toEqual(['Build', 'Alpha']);
    expect(model.columns[4]?.groups[0]?.cards.map((card) => card.item.id)).toEqual(['b']);
    expect(model.cards.find((card) => card.item.id === 'b')?.height).toBeGreaterThan(
      model.cards.find((card) => card.item.id === 'nested')!.height,
    );
  });

  it('reorders the complete sibling list while leaving parentage unchanged', () => {
    expect(reorderedSiblingIds(branchItems, 'a', 'b', 'after')).toEqual(['b', 'a', 'hidden']);
    expect(reorderedSiblingIds(branchItems, 'b', 'a', 'before')).toEqual(['b', 'a', 'hidden']);
    expect(reorderedSiblingIds(branchItems, 'a', 'nested', 'after')).toBeNull();
  });
});

describe('Kanban component', () => {
  const cardItems = branchItems.filter((entry) => entry.id !== 'nested');
  function renderBoard(overrides: Partial<React.ComponentProps<typeof Kanban>> = {}) {
    const onCommand = vi.fn(async () => undefined);
    const onSelect = vi.fn();
    const view = render(<Kanban items={cardItems} focusId="root" selectedId={null} disabled={false}
      onSelect={onSelect} onCommand={onCommand} {...overrides} />);
    return { ...view, onCommand, onSelect };
  }

  it('shows title-only cards and still supports keyboard opening', () => {
    const { onCommand, onSelect } = renderBoard();
    const card = screen.getByRole('button', { name: 'Alpha, Now' });
    expect(card.textContent).toBe('Alpha');
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('keeps historical cards read-only while allowing opening', () => {
    const { onSelect, onCommand } = renderBoard({ disabled: true });
    const card = screen.getByRole('button', { name: 'Alpha, Now' });
    dragFromTo(card, screen.getByRole('listitem', { name: /Later:/ }));
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('drops onto a column or parent group by changing status without reordering', async () => {
    const { onCommand } = renderBoard();
    const handle = screen.getByRole('button', { name: 'Alpha, Now' });
    const laterColumn = screen.getByRole('listitem', { name: /Later:/ });
    dragFromTo(handle, laterColumn, 10);
    await waitFor(() => expect(onCommand).toHaveBeenCalledWith({ type: 'update', id: 'a', patch: { status: 'Later' } }));
    expect(onCommand).toHaveBeenCalledTimes(1);

    // Blank space below a short column still resolves to the column by horizontal position.
    cleanup();
    const blank = renderBoard();
    const board = document.querySelector('.lm-kanban__board')!;
    const later = screen.getByRole('listitem', { name: /Later:/ });
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 800, top: 0, bottom: 600 } as DOMRect);
    vi.spyOn(later, 'getBoundingClientRect').mockReturnValue({ left: 200, right: 400, top: 0, bottom: 130 } as DOMRect);
    dragFromTo(screen.getByRole('button', { name: 'Alpha, Now' }), board, 10, 550, 250);
    await waitFor(() => expect(blank.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'a', patch: { status: 'Later' } }));
    expect(blank.onCommand).toHaveBeenCalledTimes(1);

    cleanup();
    const second = renderBoard();
    const group = document.querySelector('[data-lm-kanban-group][data-kanban-status="Later"]');
    expect(group).not.toBeNull();
    dragFromTo(screen.getByRole('button', { name: 'Alpha, Now' }), group, 11);
    await waitFor(() => expect(second.onCommand).toHaveBeenCalledWith({ type: 'update', id: 'a', patch: { status: 'Later' } }));
    expect(second.onCommand).toHaveBeenCalledTimes(1);
  });

  it('does not drop into a horizontally clipped column outside the board', () => {
    const { onCommand } = renderBoard();
    const board = document.querySelector('.lm-kanban__board')!;
    const later = screen.getByRole('listitem', { name: /Later:/ });
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 800, top: 0, bottom: 600 } as DOMRect);
    vi.spyOn(later, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 200, top: 0, bottom: 130 } as DOMRect);
    dragFromTo(screen.getByRole('button', { name: 'Alpha, Now' }), document.body, 30, 550, 50);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('issues status then full sibling reorder when dropping on a same-parent card in another column', async () => {
    const { onCommand } = renderBoard();
    const beta = screen.getByRole('button', { name: 'Beta, Later' });
    dragFromTo(screen.getByRole('button', { name: 'Alpha, Now' }), beta, 12);
    await waitFor(() => expect(onCommand).toHaveBeenCalledTimes(2));
    expect(onCommand).toHaveBeenNthCalledWith(1, { type: 'update', id: 'a', patch: { status: 'Later' } });
    expect(onCommand).toHaveBeenNthCalledWith(2, { type: 'reorder', parentId: 'root', ids: ['b', 'a', 'hidden'] });
  });

  it.each(['Status', 'Importance', 'Effort'] as const)('changes status without reordering under %s sorting', async sort => {
    const {onCommand} = renderBoard({sort});
    dragFromTo(screen.getByRole('button', {name: 'Alpha, Now'}), screen.getByRole('button', {name: 'Beta, Later'}), 12);
    await waitFor(() => expect(onCommand).toHaveBeenCalledExactlyOnceWith({type: 'update', id: 'a', patch: {status: 'Later'}}));
  });

  it('does nothing for a same-status sorted drop and restores reordering with Order', async () => {
    const sameStatus = cardItems.map(item => ({...item, status: 'Now' as const}));
    const {onCommand, rerender} = renderBoard({items: sameStatus, sort: 'Importance'});
    dragFromTo(screen.getByRole('button', {name: 'Alpha, Now'}), screen.getByRole('button', {name: 'Beta, Now'}), 12);
    expect(onCommand).not.toHaveBeenCalled();
    rerender(<Kanban items={sameStatus} focusId="root" selectedId={null} disabled={false} sort="Order" onSelect={vi.fn()} onCommand={onCommand} />);
    dragFromTo(screen.getByRole('button', {name: 'Alpha, Now'}), screen.getByRole('button', {name: 'Beta, Now'}), 13);
    await waitFor(() => expect(onCommand).toHaveBeenCalledExactlyOnceWith({type: 'reorder', parentId: 'root', ids: ['b', 'a', 'hidden']}));
  });

  it('changes status but never reorders when the target belongs to an unrelated parent group', async () => {
    const { onCommand } = renderBoard({ items: branchItems });
    const nested = screen.getByRole('button', { name: 'Nested, Doing' });
    dragFromTo(screen.getByRole('button', { name: 'Beta, Later' }), nested, 13);
    await waitFor(() => expect(onCommand).toHaveBeenCalledWith({ type: 'update', id: 'b', patch: { status: 'Doing' } }));
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it('cancels pointer drops on Escape, cancellation, lost capture, and branch or disabled changes', async () => {
    const first = renderBoard();
    const firstHandle = screen.getByRole('button', { name: 'Alpha, Now' });
    fireEvent.pointerDown(firstHandle, { button: 0, pointerId: 20 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(firstHandle, { pointerId: 20 });
    expect(first.onCommand).not.toHaveBeenCalled();

    cleanup();
    const second = renderBoard();
    const secondHandle = screen.getByRole('button', { name: 'Alpha, Now' });
    fireEvent.pointerDown(secondHandle, { button: 0, pointerId: 21 });
    fireEvent.pointerCancel(secondHandle, { pointerId: 21 });
    fireEvent.pointerUp(secondHandle, { pointerId: 21 });
    expect(second.onCommand).not.toHaveBeenCalled();

    cleanup();
    const third = renderBoard();
    const thirdHandle = screen.getByRole('button', { name: 'Alpha, Now' });
    fireEvent.pointerDown(thirdHandle, { button: 0, pointerId: 22 });
    fireEvent.lostPointerCapture(thirdHandle, { pointerId: 22 });
    fireEvent.pointerUp(thirdHandle, { pointerId: 22 });
    expect(third.onCommand).not.toHaveBeenCalled();

    cleanup();
    const fourth = renderBoard();
    const fourthHandle = screen.getByRole('button', { name: 'Alpha, Now' });
    fireEvent.pointerDown(fourthHandle, { button: 0, pointerId: 23 });
    fourth.rerender(<Kanban items={cardItems} focusId="root" selectedId={null} disabled={true}
      onSelect={fourth.onSelect} onCommand={fourth.onCommand} />);
    fireEvent.pointerUp(fourthHandle, { pointerId: 23 });
    expect(fourth.onCommand).not.toHaveBeenCalled();

    cleanup();
    const fifth = renderBoard();
    const fifthHandle = screen.getByRole('button', { name: 'Alpha, Now' });
    fireEvent.pointerDown(fifthHandle, { button: 0, pointerId: 24 });
    fifth.rerender(<Kanban items={cardItems} focusId="a" selectedId={null} disabled={false}
      onSelect={fifth.onSelect} onCommand={fifth.onCommand} />);
    fireEvent.pointerUp(fifthHandle, { pointerId: 24 });
    expect(fifth.onCommand).not.toHaveBeenCalled();
  });

  it('opens on a tap, but moves a visual card and suppresses opening after a drag', () => {
    const { onCommand, onSelect } = renderBoard();
    const card = screen.getByRole('button', { name: 'Alpha, Now' });
    fireEvent.pointerDown(card, { button: 0, pointerId: 40, clientX: 20, clientY: 30 });
    fireEvent.pointerUp(card, { pointerId: 40, clientX: 21, clientY: 30 });
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('a');
    expect(onCommand).not.toHaveBeenCalled();
    onSelect.mockClear();
    pointTarget(document.body);
    fireEvent.pointerDown(card, { button: 0, pointerId: 41, clientX: 20, clientY: 30 });
    fireEvent.pointerMove(card, { pointerId: 41, clientX: 70, clientY: 60 });
    const preview = document.querySelector<HTMLElement>('.lm-kanban__drag-preview')!;
    expect(preview.textContent).toBe('Alpha');
    expect(preview.style.left).toBe('50px');
    expect(preview.style.top).toBe('30px');
    fireEvent.pointerUp(card, { pointerId: 41, clientX: 70, clientY: 60 });
    fireEvent.click(card);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('.lm-kanban__drag-preview')).toBeNull();
  });
});

it('sizes board cards by automatic shares through the full hierarchy', () => {
  const items = [item('root', null), item('a', 'root', { weight: 40 }), { ...item('b', 'root', { weight: 999 }), allocationAuto: true }, { ...item('c', 'root'), allocationAuto: true }, item('nested', 'b')];
  const shares = branchRelativeShares(items, 'root');
  expect(shares.get('a')).toBe(.4);
  expect(shares.get('b')).toBe(.3);
  expect(shares.get('nested')).toBe(.3);
  expect(shares.get('c')).toBe(.3);
});
