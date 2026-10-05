import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'], environment: 'node', testTimeout: 10000,
    // Let jsdom provide browser storage instead of Node's process-wide Web Storage.
    execArgv: ['--no-experimental-webstorage'],
  },
});
