import { parsePropertyFilters, type PropertyFilters } from './property-filters';
export interface ViewRoute { itemId: string | null; focusId: string | null; snapshotId?: string; view?: 'kanban' | 'outline'; filters?: PropertyFilters }

export function parseRoute(url: URL, demo = browserDemo): ViewRoute {
  if (demo) url = new URL(url.hash.slice(1) || '/', url.origin);
  const match = url.pathname.match(/^\/items\/([^/]+)\/?$/);
  const view = url.searchParams.get('view');
  const filters = parsePropertyFilters(url.searchParams.get('filters'));
  return { itemId: match ? decodeURIComponent(match[1]!) : null, focusId: url.searchParams.get('focus'), snapshotId: url.searchParams.get('snapshot') || undefined, ...(Object.keys(filters).length ? {filters} : {}), ...(view === 'kanban' || view === 'outline' ? { view } : {}) };
}

export function routeUrl(route: ViewRoute, demo = browserDemo): string {
  const query = new URLSearchParams();
  if (route.focusId) query.set('focus', route.focusId);
  if (route.snapshotId) query.set('snapshot', route.snapshotId);
  if (route.view) query.set('view', route.view);
  if (route.filters && Object.keys(route.filters).length) query.set('filters', JSON.stringify(route.filters));
  return `${demo ? `${appBase}#` : ''}${route.itemId ? `/items/${encodeURIComponent(route.itemId)}` : '/'}${query.size ? `?${query}` : ''}`;
}

/** getRandomValues is available on the Mac's HTTP/Tailscale origin too. */
export function newClientId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
import { appBase, browserDemo } from './runtime';
