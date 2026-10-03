import { isAbsolute } from 'node:path';
import { normalizeServerUrl } from '../src/server-discovery.js';

export type DesktopConfig =
  | { mode: 'local'; dataDir: string; port: number; shareNetwork: boolean }
  | { mode: 'remote'; url: string };

export function parseConfig(value: unknown): DesktopConfig {
  if (!value || typeof value !== 'object') throw new Error('Choose a local workspace or server.');
  const config = value as Record<string, unknown>;
  if (config.mode === 'remote' && typeof config.url === 'string') return { mode: 'remote', url: normalizeServerUrl(config.url.trim()) };
  if (config.mode !== 'local' || typeof config.dataDir !== 'string' || !isAbsolute(config.dataDir)) throw new Error('Choose an absolute workspace directory.');
  if (!Number.isInteger(config.port) || Number(config.port) < 0 || Number(config.port) > 65535) throw new Error('Port must be between 0 and 65535. Use 0 for an available port.');
  if (typeof config.shareNetwork !== 'boolean') throw new Error('Choose whether to enable network access.');
  return { mode: 'local', dataDir: config.dataDir, port: Number(config.port), shareNetwork: config.shareNetwork };
}

/** Only explicitly supported external link schemes can leave the web sandbox. */
export function externalLinkAllowed(input: string): boolean {
  try { return ['https:', 'http:', 'mailto:', 'codex:'].includes(new URL(input).protocol); }
  catch { return false; }
}
