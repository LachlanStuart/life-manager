// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/properties';
import type { Item, Status, WorkspaceSettings } from '../src/types';
import { SunburstDisplaySettings } from '../ui/SunburstDisplaySettings';
import Sunburst, {
  annularSectorPath,
  buildSunburstLayout,
  effortLayers,
  shareForDisplacement,
  segmentLabel,
} from '../ui/Sunburst';

import { DEFAULT_SUNBURST_DISPLAY, SUNBURST_DISPLAY_KEY, readSunburstDisplay, writeSunburstDisplay } from '../ui/sunburst-display';

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

function item(
  id: string,
  parentId: string | null,
  weight: number,
  included = true,
  effortOverride: number | null = null,
  status: Status = 'Now',
): Item {
  return {
    id,
    parentId,
    order: Number(id.replace(/\D/g, '')) || 0,
    title: `Item ${id}`,
    status,
    notes: '',
    included,
    weight,
    effortOverride,
  };
}

describe('sunburst effort layers', () => {
  it('caps only the visual excess while retaining the real assessment', () => {
    expect(effortLayers(250)).toEqual({
      base: 1,
      excess: 0.9,
      displayed: 190,
      actual: 250,
    });
    expect(effortLayers(150)).toEqual({
      base: 1,
      excess: 0.5,
      displayed: 150,
      actual: 150,
    });
    expect(effortLayers(190).excess).toBe(0.9);
  });

  it('sanitises invalid and negative values without affecting valid zero', () => {
    expect(effortLayers(-10).actual).toBe(0);
    expect(effortLayers(Number.NaN).actual).toBe(0);
    expect(effortLayers(0).base).toBe(0);
  });
});

describe('sunburst geometry', () => {
  it('produces a valid near-full annular path for a single child', () => {
    const path = annularSectorPath(0, Math.PI * 2, 40, 100, 0.001, 1);
    expect(path).toContain('A 99 99');
    expect(path).toContain('A 41 41');
    expect(path).not.toContain('NaN');
  });

  it('keeps short language names visible despite the truncation threshold', () => {
    const layout = buildSunburstLayout([{ ...item('a1', null, 1), title: 'JP' }], { focusId: null, showAll: false, efforts: {} });
    expect(segmentLabel(layout[0]!, DEFAULT_SUNBURST_DISPLAY, 390)?.title).toBe('JP');
  });

  it('uses exact intended local shares in ordinary mode', () => {
    const items = [item('a1', null, 1), item('a2', null, 3)];
    const layout = buildSunburstLayout(items, {
      focusId: null,
      showAll: false,
      efforts: { a1: 20, a2: 210 },
    });
    expect(layout.map((segment) => segment.displayShare)).toEqual([25, 75]);
    expect(layout[1]?.effort).toBe(210);
  });

  it('fills the available radius when only one or two levels are displayed', () => {
    const shallow = buildSunburstLayout(
      [item('a1', null, 1), item('a2', null, 1)],
      { focusId: null, showAll: false, efforts: {} },
    );
    expect(shallow[0]?.innerRadius).toBe(0);
    expect(shallow[0]?.outerRadius).toBe(468);

    const twoLevels = buildSunburstLayout(
      [item('a1', null, 1), item('a2', 'a1', 1)],
      { focusId: null, showAll: false, efforts: {} },
    );
    expect(twoLevels[0]!.outerRadius - twoLevels[0]!.innerRadius).toBeLessThan(twoLevels[1]!.outerRadius - twoLevels[1]!.innerRadius);
    expect(twoLevels[1]?.outerRadius).toBe(468);
  });

  it('adjusts initial share in virtual angular space past the parent edge', () => {
    expect(shareForDisplacement(30, Math.PI / 4, Math.PI / 2)).toBe(80);
    expect(shareForDisplacement(30, -Math.PI, Math.PI / 2)).toBe(.1);
    expect(shareForDisplacement(30, Math.PI, Math.PI / 2)).toBe(99.9);
  });

  it('ghosts excluded Items at temporary even shares in Show all', () => {
    const items = [
      item('a1', null, 99),
      item('a2', null, 1, false),
      item('a3', null, 10),
    ];
    const ordinary = buildSunburstLayout(items, {
      focusId: null,
      showAll: false,
      efforts: {},
    });
    expect(ordinary.map((segment) => segment.id)).toEqual(['a1', 'a3']);

    const shown = buildSunburstLayout(items, {
      focusId: null,
      showAll: true,
      efforts: {},
    });
    expect(shown).toHaveLength(3);
    for (const segment of shown) expect(segment.displayShare).toBeCloseTo(100 / 3, 10);
    expect(shown.find((segment) => segment.id === 'a2')?.included).toBe(false);
    expect(items[1]?.included).toBe(false);
    expect(items[1]?.weight).toBe(1);
  });

  it('extends leaves through unused rings without overlapping their siblings or descendants', () => {
    const layout = buildSunburstLayout([item('a1', null, 1), item('a2', null, 1), item('b1', 'a2', 1), item('c1', 'b1', 1)],
      { focusId: null, showAll: false, efforts: {} });
    const [leaf, parent, child, grandchild] = ['a1', 'a2', 'b1', 'c1'].map(id => layout.find(segment => segment.id === id)!);
    expect(leaf!.outerRadius).toBe(468);
    expect(leaf!.endAngle).toBe(parent!.startAngle);
    expect(parent!.outerRadius).toBe(child!.innerRadius);
    expect(child!.outerRadius).toBe(grandchild!.innerRadius);
    expect(grandchild!.outerRadius).toBeCloseTo(468);
  });

  it('places radial titles along the wedge and keeps the left half upright', () => {
    const layout = buildSunburstLayout([item('a1', null, 1), item('a2', null, 1)], { focusId: null, showAll: false, efforts: {} });
    const right = segmentLabel(layout[0]!, DEFAULT_SUNBURST_DISPLAY, 650)!;
    const left = segmentLabel(layout[1]!, DEFAULT_SUNBURST_DISPLAY, 650)!;
    expect(right.radial).toBe(true);
    expect(right.textAnchor).toBe('end');
    expect(left.textAnchor).toBe('start');
    expect(right.transform).toContain('rotate(0)');
    expect(left.transform).toContain('rotate(360)');
    expect(segmentLabel(layout[0]!, { ...DEFAULT_SUNBURST_DISPLAY, radialLabels: false }, 650)?.radial).toBe(false);
  });

  it('focuses on a branch and caps the rendered depth for large trees', () => {
    const items: Item[] = [item('a1', null, 1)];
    let parentId = 'a1';
    for (let depth = 2; depth <= 12; depth += 1) {
      const next = item(`a${depth}`, parentId, 1);
      items.push(next);
      parentId = next.id;
    }
    const layout = buildSunburstLayout(items, {
      focusId: 'a1',
      showAll: false,
      efforts: {},
      maxDepth: 4,
    });
    expect(layout[0]?.id).toBe('a2');
    expect(layout).toHaveLength(4);
    expect(layout[3]?.hasDeeperChildren).toBe(true);
    expect(Math.max(...layout.map((segment) => segment.depth))).toBe(3);
  });
});

beforeAll(() => {
  // jsdom does not currently provide PointerEvent coordinates.
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
});

function mount(items: Item[], props: Partial<React.ComponentProps<typeof Sunburst>> = {}) {
  const callbacks = { onSelect: vi.fn(), onFocus: vi.fn(), onAllocate: vi.fn(), onEffort: vi.fn(), onCreate: vi.fn() };
  const view = render(<Sunburst items={items} selectedId={null} focusId={null} showAll={false} {...callbacks} {...props} />);
  const svg = view.container.querySelector('svg') as SVGSVGElement;
  Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
    width: 1000, height: 1000, toJSON: () => ({}),
  }) });
  Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  return { ...view, ...callbacks, svg };
}
const pointAt = (degrees: number, radius = 300) => ({
  clientX: 500 + radius * Math.sin(degrees * Math.PI / 180),
  clientY: 500 - radius * Math.cos(degrees * Math.PI / 180), pointerId: 1,
});

describe('sunburst interactions', () => {
  it.each([['Navigate', false], ['Omni', false], ['Navigate', true]] as const)('%s (compact=%s) opens on click, zooms on double-click, and cancels pending selection on mode change', (mode, compact) => {
    vi.useFakeTimers();
    const items = [item('a1', null, 1), item('a2', null, 1), item('a3', 'a1', 1)];
    const view = mount(items, {mode, compact});
    const slice = screen.getByRole('treeitem', {name: /Item a1/});
    fireEvent.click(slice, {detail: 1});
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.onFocus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith('a1');
    view.onSelect.mockClear();
    fireEvent.click(slice, {detail: 1});
    vi.advanceTimersByTime(320);
    fireEvent.click(slice, {detail: 2}); fireEvent.doubleClick(slice);
    vi.advanceTimersByTime(450);
    expect(view.onFocus).toHaveBeenCalledExactlyOnceWith('a1');
    expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.click(slice, {detail: 1});
    view.rerender(<Sunburst items={items} selectedId={null} focusId={null} showAll={false} mode="Importance"
      onSelect={view.onSelect} onFocus={view.onFocus} onAllocate={view.onAllocate} />);
    vi.advanceTimersByTime(450);
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.onFocus).toHaveBeenCalledTimes(1);
  });

  it.each([['Navigate', false], ['Omni', false], ['Navigate', true]] as const)('%s (compact=%s) opens immediately on tap and zooms only on a stationary long press', (mode, compact) => {
    vi.useFakeTimers();
    const view = mount([item('a1', null, 1), item('a2', 'a1', 1)], {mode, compact});
    const slice = screen.getByRole('treeitem', {name: /Item a1/});
    const point = {pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200};
    fireEvent.pointerDown(slice, point); vi.advanceTimersByTime(100);
    fireEvent.pointerUp(view.svg, point); fireEvent.click(slice, {detail: 1});
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith('a1');
    expect(view.onFocus).not.toHaveBeenCalled(); view.onSelect.mockClear();
    fireEvent.pointerDown(slice, point); vi.advanceTimersByTime(550);
    expect(view.onFocus).toHaveBeenCalledExactlyOnceWith('a1');
    fireEvent.pointerUp(view.svg, point); fireEvent.click(slice, {detail: 1});
    expect(view.onSelect).not.toHaveBeenCalled(); view.onFocus.mockClear();
    fireEvent.pointerDown(slice, point);
    fireEvent.pointerMove(view.svg, {...point, clientY: 220}); vi.advanceTimersByTime(600);
    fireEvent.pointerUp(view.svg, point); fireEvent.click(slice, {detail: 1});
    expect(view.onFocus).not.toHaveBeenCalled(); expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(slice, point); fireEvent.pointerCancel(view.svg, point); vi.advanceTimersByTime(600);
    expect(view.onFocus).not.toHaveBeenCalled();
    expect(view.onSelect).not.toHaveBeenCalled();
  });

  it('Omni exposes small controls on every slice and dragging highlights without opening details', () => {
    const onHighlight = vi.fn();
    const view = mount([item('a1', null, 1), item('a2', null, 1)], { mode: 'Omni', onHighlight });
    fireEvent.pointerEnter(screen.getByRole('treeitem', { name: /Item a1/ }));
    expect(view.container.querySelector('.lm-sunburst__resize-guide, .lm-sunburst__radial-guide')).toBeNull();
    expect(screen.getAllByRole('slider')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /Add child to/ })).toHaveLength(2);
    const importance = screen.getByRole('slider', { name: 'Drag importance for Item a2' });
    expect(Number(importance.getAttribute('r'))).toBeCloseTo(5 * 1000 / 650);
    fireEvent.pointerDown(importance, pointAt(360));
    fireEvent.pointerMove(view.svg, pointAt(396));
    fireEvent.pointerUp(view.svg, pointAt(396));
    expect(view.onAllocate.mock.calls[0]?.[1]).toBeCloseTo(60);
    expect(onHighlight).toHaveBeenCalledWith('a2');
    expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Drag effort for Item a1' }), { key: 'ArrowUp' });
    expect(view.onEffort).toHaveBeenCalledExactlyOnceWith('a1', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Add child to Item a1' }));
    expect(view.onCreate).toHaveBeenCalledExactlyOnceWith('a1');
    expect(view.onSelect).not.toHaveBeenCalled();
  });

  it('Omni honours Show all and historical editing restrictions', () => {
    const items = [item('a1', null, 1), item('a2', null, 1)];
    const view = mount(items, { mode: 'Omni', showAll: true });
    expect(screen.queryByRole('slider', { name: /Drag importance/ })).toBeNull();
    expect(screen.getAllByRole('slider', { name: /Drag effort/ })).toHaveLength(2);
    view.rerender(<Sunburst items={items} selectedId={null} focusId={null} showAll={false} mode="Omni" disabled
      onSelect={view.onSelect} onFocus={view.onFocus} onAllocate={view.onAllocate} onEffort={view.onEffort} onCreate={view.onCreate} />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add child to/ })).toBeNull();
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: /Item a1/ }));
    expect(view.onSelect).toHaveBeenCalledWith('a1');
  });

  it('keeps long names discoverable in narrow slices with a clipped abbreviated label', () => {
    const narrow = { ...item('a1', null, 10), title: 'Read a short story in Japanese and take detailed notes on unfamiliar vocabulary' };
    const view = mount([narrow, item('a2', null, 90)]);
    const slice = screen.getByRole('treeitem', { name: /Read a short story in Japanese/ });
    const label = slice.querySelector('.lm-sunburst__label');
    expect(label).not.toBeNull();
    expect(label?.querySelector('tspan')?.textContent).toMatch(/^Read.*…$/);
    expect(label?.parentElement?.getAttribute('clip-path')).toMatch(/^url\(#/);
    fireEvent.click(slice);
    expect(view.onSelect).toHaveBeenCalledWith('a1');
  });

  it('uses the overview centre for Items and reserves the Back control for a focused branch', () => {
    const view = mount([item('a1', null, 1), item('a2', 'a1', 1)]);
    expect(view.container.querySelector('.lm-sunburst__center')).toBeNull();
    expect(screen.queryByText('Life')).toBeNull();
    view.rerender(<Sunburst items={[item('a1', null, 1), item('a2', 'a1', 1)]} selectedId={null} focusId="a1" showAll={false}
      onSelect={view.onSelect} onFocus={view.onFocus} onAllocate={view.onAllocate} />);
    expect(screen.getByRole('button', { name: 'Return to overview' })).toBeDefined();
  });

  it.each(['Enter', ' '])('opens details with %s and zooms with Shift in Navigate mode', key => {
    const view = mount([item('a1', null, 1), item('a2', 'a1', 1)], { mode: 'Navigate' });
    const slice = screen.getByRole('treeitem', { name: /Item a1/ });
    fireEvent.keyDown(slice, {key});
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith('a1');
    expect(view.onFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(slice, {key, shiftKey: true});
    expect(view.onFocus).toHaveBeenCalledExactlyOnceWith('a1');
    expect(view.onSelect).toHaveBeenCalledTimes(1);
  });

  it('opens the focused Item from the center and uses separate controls to zoom out', () => {
    const view = mount([item('a1', null, 1), item('a2', 'a1', 1), item('a3', 'a2', 1)], { focusId: 'a2' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Item a2 details' }));
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith('a2');
    expect(view.onFocus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Return to Item a1' }));
    expect(view.onFocus).toHaveBeenLastCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: 'Return to full overview' }));
    expect(view.onFocus).toHaveBeenLastCalledWith(null);
  });

  it('disables all allocation routes in Show all and leaves membership untouched', () => {
    const items = [item('a1', null, 1), item('a2', null, 1, false)];
    const view = mount(items, { mode: 'Importance', selectedId: 'a2', showAll: true });
    const slider = screen.getByRole('slider', { name: /Intended share/ });
    expect((slider as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(slider, { target: { value: '70' } });
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /Item a2/ }), { key: 'ArrowRight' });
    expect(view.onAllocate).not.toHaveBeenCalled();
    expect(view.container.querySelector('.lm-sunburst__resize-handle')).toBeNull();
    expect(items[1]?.included).toBe(false);
  });

  it('drags an unselected slice immediately, without first revealing its handle', () => {
    const view = mount([item('a1', null, 1), item('a2', null, 1)], { mode: 'Importance' });
    expect(screen.queryByRole('slider', { name: /Drag importance/ })).toBeNull();
    fireEvent.pointerDown(screen.getByRole('treeitem', { name: /Item a1/ }), pointAt(90));
    fireEvent.pointerMove(view.svg, pointAt(126));
    fireEvent.pointerUp(view.svg, pointAt(126));
    expect(view.onSelect).toHaveBeenCalledWith('a1');
    expect(view.onAllocate.mock.calls[0]?.[1]).toBeCloseTo(60);
  });

  it('drags effort on first contact but does not turn a tap into a manual override', () => {
    const view = mount([item('a1', null, 1)], { mode: 'Effort' });
    const slice = screen.getByRole('treeitem');
    fireEvent.pointerDown(slice, pointAt(90, 100));
    fireEvent.pointerUp(view.svg, pointAt(90, 101));
    expect(view.onEffort).not.toHaveBeenCalled();
    fireEvent.pointerDown(slice, pointAt(90, 100));
    fireEvent.pointerMove(view.svg, pointAt(90, 334));
    fireEvent.pointerUp(view.svg, pointAt(90, 334));
    expect(view.onEffort).toHaveBeenCalledExactlyOnceWith('a1', 50);
  });

  it('shows the smaller handle on mouse hover without selecting or changing the Item', () => {
    const view = mount([item('a1', null, 1), item('a2', null, 1)], { mode: 'Importance' });
    fireEvent.pointerEnter(screen.getByRole('treeitem', { name: /Item a2/ }));
    expect(Number(screen.getByRole('slider', { name: 'Drag importance for Item a2' }).getAttribute('r'))).toBeCloseTo(22 * 1000 / 650 * .75);
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.onAllocate).not.toHaveBeenCalled();
  });

  it('saves display preferences locally and restores them on remount without changing Items', () => {
    const view = mount([item('a1', null, 1)]);
    const settings = render(<SunburstDisplaySettings />);
    fireEvent.click(screen.getByLabelText('Radial titles'));
    fireEvent.change(screen.getByLabelText('Layer 1 width'), { target: { value: '1.2' } });
    expect(JSON.parse(localStorage.getItem(SUNBURST_DISPLAY_KEY)!)).toMatchObject({ radialLabels: false });
    settings.unmount();
    view.unmount();
    mount([item('a1', null, 1)]);
    const restored = render(<SunburstDisplaySettings />);
    expect(screen.getByLabelText<HTMLInputElement>('Radial titles').checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>('Layer 1 width').value).toBe('1.2');
    fireEvent.click(screen.getByRole('button', { name: 'Reset display' }));
    expect(readSunburstDisplay()).toEqual(DEFAULT_SUNBURST_DISPLAY);
    localStorage.setItem(SUNBURST_DISPLAY_KEY, '{broken');
    expect(readSunburstDisplay()).toEqual(DEFAULT_SUNBURST_DISPLAY);
    expect(view.onAllocate).not.toHaveBeenCalled();
    restored.unmount();
  });

  it('keeps display edits in memory when browser storage is unavailable', () => {
    const settings = render(<SunburstDisplaySettings />);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    fireEvent.click(screen.getByLabelText('Radial titles'));
    expect(screen.getByLabelText<HTMLInputElement>('Radial titles').checked).toBe(false);
    expect(readSunburstDisplay().radialLabels).toBe(true);
    setItem.mockRestore();
    // Restore the persisted baseline so the module-level snapshot does not leak into later tests.
    writeSunburstDisplay(DEFAULT_SUNBURST_DISPLAY);
    settings.unmount();
  });
  it('supports keyboard importance and commits the range preview only on release', () => {
    const view = mount([item('a1', null, 1), item('a2', null, 3)], { mode: 'Importance', selectedId: 'a1' });
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /Item a1/ }), { key: 'ArrowRight' });
    expect(view.onAllocate).toHaveBeenCalledWith('a1', 26);
    view.onAllocate.mockClear();
    const slider = screen.getByRole('slider', { name: /Intended share/ });
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '45' } });
    expect(view.onAllocate).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(view.onAllocate).toHaveBeenCalledExactlyOnceWith('a1', 45);
  });

  it('uses clockwise displacement from the original nonfirst sibling and preserves other ratios', () => {
    const view = mount([item('a1', null, 20), item('a2', null, 30), item('a3', null, 50)], { mode: 'Importance', selectedId: 'a2' });
    const handle = screen.getByRole('slider', { name: 'Drag importance for Item a2' });
    fireEvent.pointerDown(handle, pointAt(180));
    fireEvent.pointerMove(view.svg, pointAt(216));
    fireEvent.pointerMove(view.svg, pointAt(234));
    expect(view.onAllocate).not.toHaveBeenCalled();
    expect(screen.getByRole('treeitem', { name: /Item a1/ }).getAttribute('aria-label')).toContain('16% share');
    expect(screen.getByRole('treeitem', { name: /Item a3/ }).getAttribute('aria-label')).toContain('39% share');
    fireEvent.pointerUp(view.svg, pointAt(234));
    expect(view.onAllocate.mock.calls[0]?.[0]).toBe('a2');
    expect(view.onAllocate.mock.calls[0]?.[1]).toBeCloseTo(45, 8);
  });

  it('puts the last sibling handle on its clockwise edge and continues beyond its parent', () => {
    const items = [item('a1', null, 1), item('a2', null, 3), item('b1', 'a1', 3), item('b2', 'a1', 1)];
    const view = mount(items, { mode: 'Importance', selectedId: 'b2' });
    const handle = screen.getByRole('slider', { name: 'Drag importance for Item b2' });
    // The parent ends at 90°, while b2 starts at 67.5°.
    expect(Number(handle.getAttribute('cy'))).toBeCloseTo(500);
    fireEvent.pointerDown(handle, pointAt(90));
    fireEvent.pointerMove(view.svg, pointAt(112.5));
    fireEvent.pointerMove(view.svg, pointAt(135));
    expect(screen.getByRole('treeitem', { name: /Item b2/ }).getAttribute('aria-label')).toContain('75% share');
    fireEvent.pointerUp(view.svg, pointAt(135));
    expect(view.onAllocate.mock.calls[0]?.[0]).toBe('b2');
    expect(view.onAllocate.mock.calls[0]?.[1]).toBeCloseTo(75, 8);
  });

  it('crosses noon clockwise continuously and cannot zero the other siblings', () => {
    const view = mount([item('a1', null, 1), item('a2', null, 1)], { mode: 'Importance', selectedId: 'a2' });
    const handle = screen.getByRole('slider', { name: 'Drag importance for Item a2' });
    fireEvent.pointerDown(handle, pointAt(360));
    fireEvent.pointerMove(view.svg, pointAt(90));
    fireEvent.pointerMove(view.svg, pointAt(180));
    fireEvent.pointerUp(view.svg, pointAt(190));
    expect(view.onAllocate).toHaveBeenCalledExactlyOnceWith('a2', 99.9);
  });

  it('has no pointless importance handle or keyboard allocation for a single sibling', () => {
    const view = mount([item('a1', null, 1)], { mode: 'Importance', selectedId: 'a1' });
    expect(screen.queryByRole('slider', { name: /Drag importance/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('treeitem'), { key: 'ArrowRight' });
    expect(view.onAllocate).not.toHaveBeenCalled();
  });

  it('drags effort radially through 100 and beyond 190 while retaining the uncapped value', () => {
    const view = mount([item('a1', null, 1, true, 90), item('a2', null, 1)], { mode: 'Effort', selectedId: 'a1' });
    const handle = screen.getByRole('slider', { name: 'Drag effort for Item a1' });
    fireEvent.pointerDown(handle, pointAt(90, 100));
    fireEvent.pointerMove(view.svg, pointAt(90, 193.6));
    expect(screen.getByRole('treeitem', { name: /Item a1/ }).getAttribute('aria-label')).toContain('110% effort');
    fireEvent.pointerMove(view.svg, pointAt(90, 661.6));
    expect(screen.getByRole('treeitem', { name: /Item a1/ }).getAttribute('aria-label')).toContain('210% effort');
    expect(view.container.querySelectorAll('.lm-sunburst__effort--excess')).toHaveLength(1);
    expect(view.onEffort).not.toHaveBeenCalled();
    fireEvent.pointerUp(view.svg, pointAt(90, 661.6));
    expect(view.onEffort.mock.calls[0]?.[1]).toBeCloseTo(210, 8);
    expect(view.onAllocate).not.toHaveBeenCalled();
  });

  it('uses initial uncapped effort, ignores angular movement and decreases inward to zero', () => {
    const view = mount([item('a1', null, 1, true, 250)], { mode: 'Effort', selectedId: 'a1' });
    const handle = screen.getByRole('slider', { name: /Drag effort/ });
    fireEvent.pointerDown(handle, pointAt(90, 1300));
    fireEvent.pointerMove(view.svg, pointAt(180, 1300));
    expect(screen.getByRole('treeitem').getAttribute('aria-label')).toContain('250% effort');
    fireEvent.pointerMove(view.svg, pointAt(180, 20));
    fireEvent.pointerUp(view.svg, pointAt(180, 20));
    expect(view.onEffort).toHaveBeenCalledExactlyOnceWith('a1', 0);
  });

  it('cancels effort previews without committing or altering source data', () => {
    const items = [item('a1', null, 1, true, 50)];
    const view = mount(items, { mode: 'Effort', selectedId: 'a1' });
    fireEvent.pointerDown(screen.getByRole('slider', { name: /Drag effort/ }), pointAt(90, 100));
    fireEvent.pointerMove(view.svg, pointAt(90, 400));
    fireEvent.pointerCancel(view.svg);
    expect(view.onEffort).not.toHaveBeenCalled();
    expect(items[0]?.effortOverride).toBe(50);
  });

  it('offers phantom creation for every represented Item including focused center without mutating geometry', () => {
    const items = [item('a1', null, 1), item('a2', 'a1', 999), item('a3', 'a1', 1), item('a4', 'a2', 1)];
    const original = structuredClone(items);
    const view = mount(items, { mode: 'Create', focusId: 'a1' });
    for (const id of ['a1', 'a2', 'a3', 'a4']) fireEvent.click(screen.getByRole('button', { name: `Add child to Item ${id}` }));
    expect(view.onCreate.mock.calls.map(([id]) => id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(screen.getAllByRole('treeitem')).toHaveLength(3);
    expect(view.onAllocate).not.toHaveBeenCalled();
    expect(view.onEffort).not.toHaveBeenCalled();
    expect(items).toEqual(original);
  });

  it('keeps historical wheel browsing available while disabling mutation modes', () => {
    const view = mount([item('a1', null, 1)], { mode: 'Create', disabled: true });
    fireEvent.click(screen.getByRole('button', { name: /Add child/ }));
    fireEvent.click(screen.getByRole('treeitem'));
    fireEvent.doubleClick(screen.getByRole('treeitem'));
    expect(view.onCreate).not.toHaveBeenCalled();
    expect(view.onEffort).not.toHaveBeenCalled();
    expect(view.onAllocate).not.toHaveBeenCalled();
    expect(view.onSelect).toHaveBeenCalledWith('a1');
    expect(view.onFocus).not.toHaveBeenCalled();
  });
});

it('uses the automatic remainder for angular geometry as well as displayed shares', () => {
  const items = [item('a1', null, 40), { ...item('a2', null, 999), allocationAuto: true }, { ...item('a3', null, 1), allocationAuto: true }];
  const layout = buildSunburstLayout(items, { focusId: null, showAll: false, efforts: {} });
  expect(layout.map(segment => segment.actualShare)).toEqual([40, 30, 30]);
  expect(layout[1]!.endAngle - layout[1]!.startAngle).toBeCloseTo(2 * Math.PI * .3);
});

it('opens the status menu without a pending Omni click opening details', () => {
  vi.useFakeTimers();
  const onSelect = vi.fn(), onContextMenu = vi.fn();
  render(<Sunburst items={[item('a1', null, 1)]} mode="Omni" selectedId={null} focusId={null} showAll={false}
    onSelect={onSelect} onFocus={vi.fn()} onAllocate={vi.fn()} onContextMenu={onContextMenu} />);
  const slice = screen.getByRole('treeitem');
  fireEvent.click(slice, {detail: 1});
  fireEvent.contextMenu(slice, {clientX: 25, clientY: 50});
  vi.runAllTimers();
  expect(onContextMenu).toHaveBeenCalledWith('a1', 25, 50);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(slice, {key: 'F10', shiftKey: true});
  expect(onContextMenu).toHaveBeenCalledTimes(2);
});


it.each(['Navigate', 'Omni'] as const)('%s opens leaves and all-hidden branches on tap without changing focus', mode => {
  const items = [item('a1', null, 1), item('a2', null, 1), item('a3', 'a2', 1, false)];
  const view = mount(items, {mode});
  for (const id of ['a1', 'a2']) {
    const slice = screen.getByRole('treeitem', {name: new RegExp(`Item ${id}`)});
    fireEvent.pointerDown(slice, {pointerType: 'touch', pointerId: 1});
    fireEvent.pointerUp(view.svg, {pointerType: 'touch', pointerId: 1});
    fireEvent.click(slice, {detail: 1});
    expect(view.onSelect).toHaveBeenLastCalledWith(id);
  }
  expect(view.onFocus).not.toHaveBeenCalled();
  view.rerender(<Sunburst items={items} selectedId={null} focusId={null} showAll mode={mode}
    onSelect={view.onSelect} onFocus={view.onFocus} onAllocate={view.onAllocate} />);
  fireEvent.keyDown(screen.getByRole('treeitem', {name: /Item a2/}), {key: 'Enter', shiftKey: true});
  expect(view.onFocus).toHaveBeenCalledExactlyOnceWith('a2');
});

it('opens both branches and leaves in the compact board navigator', () => {
  const view = mount([item('a1', null, 1), item('a2', 'a1', 1)], {compact: true});
  fireEvent.click(screen.getByRole('treeitem', {name: /Item a1/}));
  fireEvent.click(screen.getByRole('treeitem', {name: /Item a2/}));
  expect(view.onFocus).not.toHaveBeenCalled();
  expect(view.onSelect.mock.calls).toEqual([['a1'], ['a2']]);
});

it('replaces an emptied branch with actions without navigating or inventing hidden children', () => {
  const items = [item('a1', null, 1), item('a2', 'a1', 1)];
  const onShowHidden = vi.fn();
  const view = mount(items, {focusId: 'a1', onShowHidden});
  const renderItems = (next: Item[], disabled = false) => view.rerender(<Sunburst items={next} selectedId={null} focusId="a1" showAll={false}
    onSelect={view.onSelect} onFocus={view.onFocus} onAllocate={view.onAllocate} onCreate={view.onCreate} onShowHidden={onShowHidden} disabled={disabled} />);
  renderItems([items[0]!, {...items[1]!, included: false}]);
  expect(screen.queryByRole('tree')).toBeNull();
  expect(view.onFocus).not.toHaveBeenCalled();
  expect(view.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Show hidden children'}));
  expect(onShowHidden).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', {name: 'Open details'}));
  expect(view.onSelect).toHaveBeenCalledWith('a1');
  fireEvent.click(screen.getByRole('button', {name: '+ Add child'}));
  expect(view.onCreate).toHaveBeenCalledWith('a1');
  renderItems([items[0]!], true);
  expect(screen.queryByRole('button', {name: 'Show hidden children'})).toBeNull();
  expect(screen.queryByRole('button', {name: '+ Add child'})).toBeNull();
  expect(screen.getByRole('button', {name: 'Open details'})).toBeTruthy();
  expect(screen.getByText('No children yet')).toBeTruthy();
});

describe('configurable sunburst colors', () => {
  const settings: WorkspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS, name: 'Studio', properties: [
    ...DEFAULT_WORKSPACE_SETTINGS.properties,
    { id: 'category', name: 'Category', options: [{ id: 'book', label: 'Reading', color: '#123456' }],
      unsetLabel: 'Uncategorised', unsetColor: '#abcdef', defaultValue: null },
  ] };
  const items = [
    { ...item('a1', null, 1, true, 40), properties: { category: 'book' } },
    { ...item('a2', null, 3, true, 150), properties: { category: null } },
  ];

  it('uses configured option and unset colors without changing allocation or effort geometry', () => {
    const view = mount(items, { settings, colorPropertyId: 'category' });
    const slices = screen.getAllByRole('treeitem');
    expect(slices[0]!.getAttribute('aria-label')).toBe('Item a1, Reading, 25% share, 40% effort');
    expect(slices[1]!.getAttribute('aria-label')).toBe('Item a2, Uncategorised, 75% share, 150% effort');
    expect(slices[0]!.style.getPropertyValue('--segment-color')).toBe('#123456');
    expect(slices[1]!.style.getPropertyValue('--segment-color')).toBe('#abcdef');
    const paths = Array.from(view.container.querySelectorAll('.lm-sunburst__sector, .lm-sunburst__effort')).map(path => path.getAttribute('d'));
    view.rerender(<Sunburst items={items} settings={settings} colorPropertyId="status" selectedId={null} focusId={null} showAll={false}
      onSelect={vi.fn()} onFocus={vi.fn()} onAllocate={vi.fn()} />);
    expect(Array.from(view.container.querySelectorAll('.lm-sunburst__sector, .lm-sunburst__effort')).map(path => path.getAttribute('d'))).toEqual(paths);
  });

  it('shows snapshot names in overview and back controls and uses its colors in the minimap', () => {
    const history = { ...settings, name: 'Studio 2025' };
    const view = mount(items, { settings: history, colorPropertyId: 'category', disabled: true });
    expect(screen.getByRole('tree', { name: 'Studio 2025 allocation overview' })).toBeTruthy();
    view.rerender(<Sunburst items={items} settings={history} colorPropertyId="category" selectedId={null} focusId="a1" showAll={false}
      onSelect={vi.fn()} onFocus={vi.fn()} onAllocate={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Return to overview' }).textContent).toContain('Studio 2025');
    expect(view.container.querySelector<SVGElement>('.lm-sunburst__minimap-sector')!.style.getPropertyValue('--segment-color')).toBe('#123456');
  });

  it('renders neutral slices without a property channel', () => {
    mount(items.map(item => ({ ...item, status: null, properties: {} })), {
      settings: { name: 'Notebook', properties: [], lifecyclePropertyId: null }, colorPropertyId: null,
    });
    expect(screen.getAllByRole('treeitem')[0]!.getAttribute('aria-label')).toBe('Item a1, 25% share, 40% effort');
    expect(screen.getAllByRole('treeitem')[0]!.style.getPropertyValue('--segment-color')).toBe('#7b8178');
  });
});
