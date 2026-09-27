export interface ViewRoute { itemId: string | null; focusId: string | null; snapshotId?: string; view?: 'kanban' }

export function parseRoute(url: URL): ViewRoute {
  const match = url.pathname.match(/^\/items\/([^/]+)$/);
  return { itemId: match ? decodeURIComponent(match[1]!) : null, focusId: url.searchParams.get('focus'), snapshotId: url.searchParams.get('snapshot') || undefined, ...(url.searchParams.get('view') === 'kanban' ? { view: 'kanban' as const } : {}) };
}

export function routeUrl(route: ViewRoute): string {
  const query = new URLSearchParams();
  if (route.focusId) query.set('focus', route.focusId);
  if (route.snapshotId) query.set('snapshot', route.snapshotId);
  if (route.view) query.set('view', route.view);
  return `${route.itemId ? `/items/${encodeURIComponent(route.itemId)}` : '/'}${query.size ? `?${query}` : ''}`;
}

/** getRandomValues is available on the Mac's HTTP/Tailscale origin too. */
export function newClientId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
