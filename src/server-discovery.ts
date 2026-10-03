import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

export interface ServerIdentity {
  application: 'life-manager';
  protocolVersion: 1;
  instanceId: string;
}

export const serverRecordName = '.server.json';

export function normalizeServerUrl(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter an http:// or https:// server address without a path, credentials, query or fragment.');
  }
  return url.origin;
}

export async function identifyServer(origin: string): Promise<ServerIdentity> {
  const response = await fetch(`${normalizeServerUrl(origin)}/api/server`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}.`);
  const identity = await response.json() as Partial<ServerIdentity>;
  if (identity.application !== 'life-manager' || identity.protocolVersion !== 1 || typeof identity.instanceId !== 'string') {
    throw new Error('This address is not a compatible Life Manager server. Update the server and try again.');
  }
  return identity as ServerIdentity;
}

const remoteWorkspace = z.object({
  dashboard: z.object({ periodId: z.string(), revision: z.number().int().nonnegative(), items: z.array(z.object({ id: z.string(), title: z.string() })) }),
  periods: z.array(z.unknown()), snapshots: z.array(z.unknown()),
  widgets: z.array(z.unknown()), promptTemplates: z.array(z.unknown()),
});

/** Explicit connections load the server's own UI, including pre-desktop releases. */
export async function validateServerConnection(origin: string): Promise<void> {
  const address = normalizeServerUrl(origin);
  const response = await fetch(`${address}/api/workspace`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error(`Could not read the workspace at ${address}/api/workspace (HTTP ${response.status}). Check the server address.`);
  const workspace: unknown = await response.json().catch(() => undefined);
  if (!remoteWorkspace.safeParse(workspace).success) throw new Error('This address did not return a Life Manager workspace. Check the server address.');
}

/** Verify the live owner, rather than trusting an old port or PID from disk. */
export async function discoverWorkspaceServer(dataDir: string): Promise<string | undefined> {
  try {
    const record = JSON.parse(await readFile(resolve(dataDir, serverRecordName), 'utf8')) as { origin: string; instanceId: string };
    const origin = normalizeServerUrl(record.origin);
    if (!['127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) return;
    const identity = await identifyServer(origin);
    if (identity.instanceId === record.instanceId) return origin;
  } catch { /* A starting, stopped or incompatible owner must not be attached to. */ }
}
