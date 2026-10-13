/** Cocoa persists these client preferences independently of its ephemeral HTTP port. */
export interface DesktopPreferences {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const clientStorage: DesktopPreferences = {
  getItem: key => window.lifeManagerDesktop?.preferences
    ? window.lifeManagerDesktop.preferences.getItem(key)
    : globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key, value) => {
    if (window.lifeManagerDesktop?.preferences) window.lifeManagerDesktop.preferences.setItem(key, value);
    else globalThis.localStorage?.setItem(key, value);
  },
};
