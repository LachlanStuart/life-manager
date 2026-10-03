/// <reference types="vite/client" />
export const browserDemo = import.meta.env.MODE === 'browser-demo';
export const appBase = import.meta.env.BASE_URL ?? '/';

declare global {
  interface Window {
    /** Finish pending edits before the desktop host disconnects this client. */
    lifeManagerFlush?: () => Promise<void>;
  }
}
