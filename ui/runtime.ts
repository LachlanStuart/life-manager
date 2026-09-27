/// <reference types="vite/client" />
export const browserDemo = import.meta.env.MODE === 'browser-demo';
export const appBase = import.meta.env.BASE_URL ?? '/';
