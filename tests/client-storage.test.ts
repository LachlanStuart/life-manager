// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { clientStorage } from '../ui/client-storage';

afterEach(() => { delete window.lifeManagerDesktop; localStorage.clear(); });

it('keeps browser and Electron preferences in local storage', () => {
  clientStorage.setItem('life-manager.theme', 'dark');
  expect(clientStorage.getItem('life-manager.theme')).toBe('dark');
  window.lifeManagerDesktop = { sendT3: vi.fn() };
  expect(clientStorage.getItem('life-manager.theme')).toBe('dark');
});

it('uses the Cocoa preference contract even when the current origin has stale storage', () => {
  localStorage.setItem('life-manager.theme', 'light');
  const preferences = { getItem: vi.fn(() => null), setItem: vi.fn() };
  window.lifeManagerDesktop = { sendT3: vi.fn(), preferences };
  expect(clientStorage.getItem('life-manager.theme')).toBeNull();
  clientStorage.setItem('life-manager.theme', 'dark');
  expect(preferences.setItem).toHaveBeenCalledWith('life-manager.theme', 'dark');
  expect(localStorage.getItem('life-manager.theme')).toBe('light');
});
