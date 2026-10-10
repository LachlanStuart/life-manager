// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyTheme, readThemePreference, useThemePreference } from '../ui/theme';

let media: EventTarget & { matches: boolean };
beforeEach(() => {
  localStorage.clear();
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function systemDark(matches: boolean) {
  act(() => { media.matches = matches; media.dispatchEvent(new Event('change')); });
}

it('follows live system changes, while explicit choices override the system', () => {
  const { result } = renderHook(useThemePreference);
  expect(result.current.preference).toBe('system');
  expect(result.current.theme).toBe('light');
  systemDark(true);
  expect(result.current.theme).toBe('dark');
  act(() => result.current.setPreference('light'));
  expect(result.current.theme).toBe('light');
  systemDark(false); systemDark(true);
  expect(result.current.theme).toBe('light');
  act(() => result.current.setPreference('dark'));
  systemDark(false);
  expect(result.current.theme).toBe('dark');
  act(() => result.current.setPreference('system'));
  expect(result.current.theme).toBe('light');
  expect(document.documentElement.style.colorScheme).toBe('light');
});

it('applies a saved preference before rendering, and defaults invalid values to system', () => {
  localStorage.setItem('life-manager.theme', 'dark');
  expect(applyTheme(readThemePreference())).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  localStorage.setItem('life-manager.theme', 'invalid');
  expect(readThemePreference()).toBe('system');
});

it('keeps settings usable when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
  const { result } = renderHook(useThemePreference);
  act(() => result.current.setPreference('dark'));
  expect(result.current.preference).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

it('adopts changes from another tab and releases media listeners on unmount', () => {
  const remove = vi.spyOn(media, 'removeEventListener');
  const { result, unmount } = renderHook(useThemePreference);
  act(() => {
    localStorage.setItem('life-manager.theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'life-manager.theme' }));
  });
  expect(result.current.theme).toBe('dark');
  unmount();
  expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
});
