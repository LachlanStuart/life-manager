// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SunburstDisplaySettings } from '../ui/SunburstDisplaySettings';
import {
  DEFAULT_SUNBURST_DISPLAY,
  MOBILE_SUNBURST_DISPLAY,
  SUNBURST_DISPLAY_KEY,
  readSunburstDisplay,
} from '../ui/sunburst-display';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function setViewport({ mobile, width = mobile ? 390 : 1280 }: { mobile: boolean; width?: number }) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  let change: (() => void) | undefined;
  const media = {
    matches: mobile,
    addEventListener: vi.fn((_type: string, listener: () => void) => { change = listener; }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return { media, change: () => change?.() };
}

describe('sunburst display defaults and settings drafts', () => {
  it('uses compact defaults on a narrow viewport and preserves desktop defaults', () => {
    setViewport({ mobile: false });
    expect(readSunburstDisplay()).toEqual(DEFAULT_SUNBURST_DISPLAY);

    localStorage.clear();
    setViewport({ mobile: true });
    expect(readSunburstDisplay()).toEqual(MOBILE_SUNBURST_DISPLAY);
  });

  it('uses responsive defaults only for fields missing from older saved preferences', () => {
    setViewport({ mobile: true });
    localStorage.setItem(SUNBURST_DISPLAY_KEY, JSON.stringify({
      ...DEFAULT_SUNBURST_DISPLAY,
      minFontSize: 12,
      labelPadding: 6,
      // Simulate a v1 preference saved before outer-edge padding existed.
      outerLabelPadding: undefined,
    }));
    const display = readSunburstDisplay();
    expect(display.minFontSize).toBe(12);
    expect(display.labelPadding).toBe(6);
    expect(display.outerLabelPadding).toBe(1);
  });

  it('refreshes unsaved responsive defaults when the media query changes', () => {
    const viewport = setViewport({ mobile: false });
    render(<SunburstDisplaySettings />);
    const minimum = screen.getByLabelText<HTMLInputElement>('Minimum font size (px)');
    expect(minimum.value).toBe('9');

    viewport.media.matches = true;
    act(viewport.change);
    expect(minimum.value).toBe('5');
    expect(readSunburstDisplay()).toEqual(MOBILE_SUNBURST_DISPLAY);
  });

  it('keeps saved custom values when the media query changes', () => {
    const viewport = setViewport({ mobile: false });
    const saved = { ...DEFAULT_SUNBURST_DISPLAY, minFontSize: 13, labelPadding: 6, outerLabelPadding: 9 };
    localStorage.setItem(SUNBURST_DISPLAY_KEY, JSON.stringify(saved));
    render(<SunburstDisplaySettings />);
    const minimum = screen.getByLabelText<HTMLInputElement>('Minimum font size (px)');
    expect(minimum.value).toBe('13');

    viewport.media.matches = true;
    act(viewport.change);
    expect(minimum.value).toBe('13');
    expect(readSunburstDisplay()).toMatchObject({ minFontSize: 13, labelPadding: 6, outerLabelPadding: 9 });
  });

  it('allows a number to be erased while editing and commits the replacement on blur', () => {
    setViewport({ mobile: true });
    render(<SunburstDisplaySettings />);
    const input = screen.getByLabelText<HTMLInputElement>('Minimum font size (px)');
    expect(input.value).toBe('5');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);

    expect(readSunburstDisplay().minFontSize).toBe(4);
    expect(JSON.parse(localStorage.getItem(SUNBURST_DISPLAY_KEY)!)).toMatchObject({ minFontSize: 4 });
  });

  it('commits on Enter and cancels an in-progress edit on Escape', () => {
    setViewport({ mobile: false });
    render(<SunburstDisplaySettings />);
    const font = screen.getByLabelText<HTMLInputElement>('Font size (px)');
    fireEvent.focus(font);
    fireEvent.change(font, { target: { value: '64' } });
    fireEvent.keyDown(font, { key: 'Enter' });
    expect(readSunburstDisplay().fontSize).toBe(64);

    fireEvent.focus(font);
    fireEvent.change(font, { target: { value: '3' } });
    fireEvent.keyDown(font, { key: 'Escape' });
    expect(readSunburstDisplay().fontSize).toBe(64);
    expect(font.value).toBe('64');
  });

  it('does not impose arbitrary upper bounds on display dimensions', () => {
    setViewport({ mobile: false });
    render(<SunburstDisplaySettings />);
    const font = screen.getByLabelText<HTMLInputElement>('Font size (px)');
    const outer = screen.getByLabelText<HTMLInputElement>('Outer-edge label padding (px)');
    const layer = screen.getByLabelText<HTMLInputElement>('Layer 1 width');

    fireEvent.change(font, { target: { value: '64' } });
    fireEvent.blur(font);
    fireEvent.change(outer, { target: { value: '32' } });
    fireEvent.blur(outer);
    fireEvent.change(layer, { target: { value: '10' } });
    fireEvent.blur(layer);

    expect(readSunburstDisplay()).toMatchObject({ fontSize: 64, outerLabelPadding: 32 });
    expect(readSunburstDisplay().ringWeights[0]).toBe(10);
    expect(font.min).toBe('');
    expect(font.max).toBe('');
  });

  it('retains structural validity for non-positive values and the ring depth limit', () => {
    setViewport({ mobile: false });
    render(<SunburstDisplaySettings />);
    const minimum = screen.getByLabelText<HTMLInputElement>('Minimum font size (px)');
    const depth = screen.getByLabelText<HTMLInputElement>('Visible layers');
    const layer = screen.getByLabelText<HTMLInputElement>('Layer 1 width');

    fireEvent.change(minimum, { target: { value: '0' } });
    fireEvent.blur(minimum);
    fireEvent.change(depth, { target: { value: '99' } });
    fireEvent.blur(depth);
    fireEvent.change(layer, { target: { value: '0' } });
    fireEvent.blur(layer);

    expect(readSunburstDisplay().minFontSize).toBe(DEFAULT_SUNBURST_DISPLAY.minFontSize);
    expect(readSunburstDisplay().maxDepth).toBe(7);
    expect(readSunburstDisplay().ringWeights[0]).toBe(DEFAULT_SUNBURST_DISPLAY.ringWeights[0]);
  });
});
