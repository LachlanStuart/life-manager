import { createContext, useContext, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
const key = 'life-manager.theme';
const query = '(prefers-color-scheme: dark)';
export const ThemeContext = createContext<Theme>('light');
export const useTheme = () => useContext(ThemeContext);

function preference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readThemePreference(): ThemePreference {
  try { return preference(localStorage.getItem(key)); } catch { return 'system'; }
}

export function applyTheme(value: ThemePreference): Theme {
  const theme = value === 'system' ? (window.matchMedia?.(query).matches ? 'dark' : 'light') : value;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181e1b' : '#f7f6f2');
  return theme;
}

export function useThemePreference() {
  const [value, setValue] = useState(readThemePreference);
  const [theme, setTheme] = useState<Theme>(() => value === 'system' ? (window.matchMedia?.(query).matches ? 'dark' : 'light') : value);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    const update = () => setTheme(applyTheme(value));
    update();
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, [value]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setValue(readThemePreference());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setPreference = (next: ThemePreference) => {
    try { localStorage.setItem(key, next); } catch { /* Keep the choice for this session. */ }
    setValue(next);
    setTheme(applyTheme(next));
  };
  return { preference: value, theme, setPreference };
}
