// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PercentInput } from '../ui/PercentInput';

beforeEach(() => {
  class Pointer extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  }
  vi.stubGlobal('PointerEvent', Pointer);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(props: Partial<React.ComponentProps<typeof PercentInput>> = {}) {
  const save = vi.fn();
  render(<PercentInput label="Effort" value={50.25} disabled={false} onSave={save} {...props} />);
  const input = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Effort' });
  return { input, save };
}

it('rounds display only, and focusing then blurring does not overwrite the underlying precision', () => {
  const { input, save } = setup();
  expect(input.value).toBe('50');
  fireEvent.focus(input);
  expect(input.value).toBe('50.25');
  fireEvent.blur(input);
  expect(input.value).toBe('50');
  expect(save).not.toHaveBeenCalled();
});

it('clears to auto and displays the calculated value as an unfocused placeholder', () => {
  const { input, save } = setup();
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '' } }); fireEvent.blur(input);
  expect(save).toHaveBeenCalledExactlyOnceWith(null);
  cleanup();
  const auto = setup({ automatic: true });
  expect(auto.input.value).toBe('');
  expect(auto.input.placeholder).toBe('50');
  fireEvent.focus(auto.input);
  expect(auto.input.placeholder).toBe('');
  fireEvent.blur(auto.input);
  expect(auto.save).not.toHaveBeenCalled();
});

it('drags immediately from the first pointer press and commits once at 300px per 100 percentage points', () => {
  const { input, save } = setup();
  fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientY: 400 });
  fireEvent.pointerMove(input, { pointerId: 1, clientY: 100 });
  expect(input.value).toBe('150');
  expect(save).not.toHaveBeenCalled();
  fireEvent.pointerUp(input, { pointerId: 1, clientY: 100 });
  expect(save).toHaveBeenCalledExactlyOnceWith(150);
});

it('clamps allocation at 100 and downward dragging at zero', () => {
  const { input, save } = setup({ max: 100 });
  fireEvent.pointerDown(input, { button: 0, clientY: 400 });
  fireEvent.pointerMove(input, { clientY: 0 }); fireEvent.pointerUp(input, { clientY: 0 });
  expect(save).toHaveBeenLastCalledWith(100);
  fireEvent.pointerDown(input, { button: 0, clientY: 0 });
  fireEvent.pointerMove(input, { clientY: 400 }); fireEvent.pointerUp(input, { clientY: 400 });
  expect(save).toHaveBeenLastCalledWith(0);
});

it('cancels drag on Escape, pointer cancellation and lost capture without saving', () => {
  const { input, save } = setup();
  for (const cancel of [() => fireEvent.keyDown(window, { key: 'Escape' }), () => fireEvent.pointerCancel(input), () => fireEvent.lostPointerCapture(input)]) {
    fireEvent.pointerDown(input, { button: 0, clientY: 400 });
    fireEvent.pointerMove(input, { clientY: 0 }); cancel(); fireEvent.pointerUp(input, { clientY: 0 });
  }
  expect(save).not.toHaveBeenCalled();
  expect(input.value).toBe('50');
});

it('turns a dragged automatic allocation into an explicit value without exceeding a fractional remainder', () => {
  const { input, save } = setup({ automatic: true, value: 20, max: 33.75 });
  fireEvent.pointerDown(input, { button: 0, clientY: 400 });
  fireEvent.pointerMove(input, { clientY: 0 }); fireEvent.pointerUp(input, { clientY: 0 });
  expect(save).toHaveBeenCalledExactlyOnceWith(33.75);
});

it('right-click clears importance without committing a pending draft on blur', () => {
  const { input, save } = setup({ clearOnContextMenu: true });
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '80' } });
  fireEvent.contextMenu(input); fireEvent.blur(input);
  expect(save).toHaveBeenCalledExactlyOnceWith(null);
});

it('does not clear disabled fields or effort on right-click', () => {
  const disabled = setup({ clearOnContextMenu: true, disabled: true });
  fireEvent.contextMenu(disabled.input);
  expect(disabled.save).not.toHaveBeenCalled();
  cleanup();
  const effort = setup(); fireEvent.contextMenu(effort.input);
  expect(effort.save).not.toHaveBeenCalled();
});
