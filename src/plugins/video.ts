import { effectivePropertyValue, lifecycleBehavior, workspaceSettings } from '../properties';
import { readdir, realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod';

import type { WidgetDefinition, WidgetActionContext } from '../widgets.js';
import type { Item, Workspace } from '../types.js';

const MAX_PATH_LENGTH = 8192;
const configSchema = z.object({
  root: z.string().trim().min(1).max(MAX_PATH_LENGTH).refine(value => !value.includes('\0')).optional(),
  exclude: z.array(z.string().trim().min(1).max(255).refine(value => !value.includes('\0'))).max(256).optional(),
}).strict();

const browseInputSchema = z.object({
  path: z.string().max(MAX_PATH_LENGTH).refine(value => !value.includes('\0')).optional(),
}).strict();

const createInputSchema = z.object({
  path: z.string().max(MAX_PATH_LENGTH).refine(value => !value.includes('\0')),
}).strict();

export type VideoWidgetConfig = {
  root: string;
  exclude: string[];
};

export type VideoEntry = {
  name: string;
  kind: 'file' | 'folder';
  /** A path relative to the configured root, using `/` separators. */
  path: string;
};

export type VideoListing = {
  root: string;
  /** The widget deliberately lists only the immediate configured root. */
  path: '';
  historical: boolean;
  entries: VideoEntry[];
};

type ResolvedEntry = VideoEntry & { canonicalPath: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Parse only the deliberately small configuration surface exposed in Markdown. */
export function parseVideoWidgetConfig(input: Record<string, unknown> | undefined): VideoWidgetConfig {
  const parsed = configSchema.parse(input ?? {});
  const root = parsed.root;
  if (!root) throw new Error('Set an absolute root directory in this video widget’s Markdown configuration.');
  if (!isAbsolute(root)) throw new Error('Video widget root must be an absolute path.');
  const exclude = parsed.exclude ?? [];
  return { root, exclude: [...new Set(exclude)] };
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function configuredRoot(config: VideoWidgetConfig): Promise<string> {
  const canonical = await realpath(config.root);
  const information = await stat(canonical);
  if (!information.isDirectory()) throw new Error('Video widget root must be a directory.');
  return canonical;
}

/**
 * Resolve a user supplied relative path and verify both lexical containment and
 * symlink containment. The latter keeps a configured root from becoming an
 * accidental path traversal into another part of the machine.
 */
async function rootEntry(root: string, inputPath: string): Promise<{ canonicalPath: string; information: Awaited<ReturnType<typeof stat>> }> {
  if (inputPath.includes('\0') || isAbsolute(inputPath)) {
    throw new Error('Video widget paths must be relative to the configured root.');
  }
  const lexical = resolve(root, inputPath);
  if (!isWithin(root, lexical)) throw new Error('Video widget path escapes the configured root.');
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(lexical);
  } catch {
    throw new Error('The selected video file or folder no longer exists.');
  }
  if (!isWithin(root, canonicalPath)) {
    throw new Error('The selected video file or folder escapes the configured root.');
  }
  return { canonicalPath, information: await stat(canonicalPath) };
}

async function referencedPath(item: Item): Promise<string | null> {
  if (!item.resourceUri) return null;
  let path: string;
  try {
    const url = new URL(item.resourceUri);
    if (url.protocol !== 'file:') return null;
    path = fileURLToPath(url);
  } catch {
    return null;
  }
  try {
    return await realpath(path);
  } catch {
    // A missing reference cannot suppress a current directory entry. Keep a
    // normalised fallback for a race in which the file is restored while the
    // listing is being assembled.
    return resolve(path);
  }
}

async function activeReferences(workspace: Workspace, historical: boolean): Promise<Set<string>> {
  if (historical) return new Set();
  const settings = workspaceSettings(workspace);
  const status = settings.properties.find(property => property.id === 'status');
  const byId = new Map(workspace.dashboard.items.map(item => [item.id, item]));
  const references = await Promise.all(workspace.dashboard.items
    .filter(item => lifecycleBehavior(item, settings, byId) !== 'complete' && !(settings.lifecyclePropertyId === 'status' && status && effectivePropertyValue(item, status, byId) === 'Cut'))
    .map(item => referencedPath(item)));
  return new Set(references.filter((value): value is string => value !== null));
}

/**
 * Enumerate one directory level. No folder is opened or recursively scanned;
 * folders are themselves selectable entries for a future external activity.
 */
export async function listVideoEntries(
  configInput: Record<string, unknown> | undefined,
  workspace: Workspace,
  historical = false,
): Promise<VideoListing> {
  const config = parseVideoWidgetConfig(configInput);
  const root = await configuredRoot(config);
  const references = await activeReferences(workspace, historical);
  const entries: ResolvedEntry[] = [];

  for (const directoryEntry of await readdir(root, { withFileTypes: true })) {
    const name = directoryEntry.name;
    if (name.startsWith('.')) continue;

    let resolved: { canonicalPath: string; information: Awaited<ReturnType<typeof stat>> };
    try {
      resolved = await rootEntry(root, name);
    } catch {
      // Broken links and links outside the configured root are invisible to the
      // listing. An explicit action against such a path still receives an error.
      continue;
    }

    const { canonicalPath, information } = resolved;
    if (information.isDirectory()) {
      if (config.exclude.includes(name)) continue;
      if (references.has(canonicalPath)) continue;
      entries.push({ name, kind: 'folder', path: name, canonicalPath });
    } else if (information.isFile()) {
      if (references.has(canonicalPath)) continue;
      entries.push({ name, kind: 'file', path: name, canonicalPath });
    }
  }

  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  return {
    root: config.root,
    path: '',
    historical,
    entries: entries.map(({ canonicalPath: _canonicalPath, ...entry }) => entry),
  };
}

function itemName(entry: VideoEntry): string {
  return entry.kind === 'folder' ? entry.name : basename(entry.name, extname(entry.name));
}

function renderEntries(entries: readonly VideoEntry[], historical: boolean): string {
  if (entries.length === 0) return '<p class="video-empty" data-video-empty>No eligible files or folders found.</p>';
  return `<ul class="video-list" data-video-list>${entries.map(entry => `<li class="video-entry">
    <span class="video-entry__name"><span class="video-entry__kind">${entry.kind === 'folder' ? 'Folder' : 'File'}</span>${escapeHtml(entry.name)}</span>
    ${historical ? '' : `<button type="button" data-video-create data-path="${escapeHtml(entry.path)}">Create Item</button>`}
  </li>`).join('')}</ul>`;
}

function renderDocument(listing: VideoListing): string {
  const title = listing.historical ? 'Historical local files' : 'Local files';
  return `<style>
*{box-sizing:border-box}body{font:14px system-ui,-apple-system,sans-serif;color:CanvasText;background:Canvas;margin:0;padding:10px;line-height:1.35}
.video-widget{max-width:48rem}.video-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}.video-toolbar strong{margin-right:auto}
button{font:inherit;padding:5px 9px;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:5px;background:Button;color:ButtonText;cursor:pointer}
button:disabled{cursor:wait;opacity:.6}.video-root{font-size:12px;opacity:.72;overflow-wrap:anywhere;margin:0 0 8px}.video-list{padding:0;margin:0;list-style:none;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:6px;overflow:hidden}
.video-entry{display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}.video-entry:last-child{border-bottom:0}.video-entry__name{min-width:0;overflow-wrap:anywhere;flex:1}.video-entry__kind{display:inline-block;min-width:3.5rem;margin-right:7px;font-size:11px;opacity:.64;text-transform:uppercase;letter-spacing:.03em}.video-empty{opacity:.72;margin:12px 0}.video-status{margin:8px 0 0;opacity:.76}.video-status:empty{margin:0}
</style>
<section class="video-widget" data-video-widget data-video-historical="${listing.historical ? 'true' : 'false'}">
  <div class="video-toolbar"><strong>${escapeHtml(title)}</strong><button type="button" data-video-refresh>Refresh</button></div>
  <p class="video-root">${escapeHtml(listing.root)}</p>
  <div data-video-content>${renderEntries(listing.entries, listing.historical)}</div>
  <p class="video-status" data-video-status role="status" aria-live="polite"></p>
</section>
<script>
(() => {
  const widget = document.querySelector('[data-video-widget]');
  const content = widget?.querySelector('[data-video-content]');
  const status = widget?.querySelector('[data-video-status]');
  const historical = widget?.getAttribute('data-video-historical') === 'true';
  const refresh = widget?.querySelector('[data-video-refresh]');
  if (!widget || !content || !status || !refresh || !window.lifeManager) return;
  const setStatus = value => { status.textContent = value; };
  const render = entries => {
    content.replaceChildren();
    if (!Array.isArray(entries) || entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'video-empty';
      empty.setAttribute('data-video-empty', '');
      empty.textContent = 'No eligible files or folders found.';
      content.append(empty);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'video-list';
    list.setAttribute('data-video-list', '');
    for (const entry of entries) {
      if (!entry || (entry.kind !== 'file' && entry.kind !== 'folder') || typeof entry.name !== 'string' || typeof entry.path !== 'string') continue;
      const row = document.createElement('li');
      row.className = 'video-entry';
      const name = document.createElement('span');
      name.className = 'video-entry__name';
      const kind = document.createElement('span');
      kind.className = 'video-entry__kind';
      kind.textContent = entry.kind === 'folder' ? 'Folder' : 'File';
      name.append(kind, document.createTextNode(entry.name));
      row.append(name);
      if (!historical) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Create Item';
        button.addEventListener('click', () => invoke('create-item', { path: entry.path }, button));
        row.append(button);
      }
      list.append(row);
    }
    content.append(list);
  };
  const invoke = async (action, input, button) => {
    if (button) button.disabled = true;
    refresh.disabled = true;
    setStatus('Working…');
    try {
      const reply = await window.lifeManager.action(action, input);
      if (reply && reply.result && Array.isArray(reply.result.entries)) render(reply.result.entries);
      setStatus(reply?.message || 'Updated.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Video widget action failed.');
    } finally {
      if (button) button.disabled = false;
      refresh.disabled = false;
    }
  };
  refresh.addEventListener('click', () => invoke('refresh', { path: '' }));
  widget.querySelectorAll('[data-video-create]').forEach(button => button.addEventListener('click', () => invoke('create-item', { path: button.getAttribute('data-path') || '' }, button)));
})();
</script>`;
}

async function refreshListing(context: WidgetActionContext): Promise<VideoListing> {
  return listVideoEntries(context.config, context.workspace, Boolean(context.snapshotId));
}

async function createItem(input: unknown, context: WidgetActionContext): Promise<{ message: string; result: VideoListing & { itemId: string } }> {
  if (context.snapshotId) throw new Error('Creating video Items is disabled in historical snapshots.');
  const { path } = createInputSchema.parse(input);
  const config = parseVideoWidgetConfig(context.config);
  const root = await configuredRoot(config);
  if (basename(path) !== path) {
    throw new Error('Video widget actions can select only immediate root entries.');
  }
  const lexical = resolve(root, path);
  const lexicalRelative = relative(root, lexical);
  if (lexicalRelative === '' || lexicalRelative.includes(sep)) {
    throw new Error('Video widget actions can select only immediate root entries.');
  }

  // Re-read the current eligible listing so a stale or double-clicked button
  // cannot create another active intention for an entry that has just been
  // referenced. The second reference check below closes the gap between this
  // listing and the mutation itself.
  const eligibleListing = await listVideoEntries(context.config, context.workspace, false);
  if (!eligibleListing.entries.some(entry => entry.path === path)) {
    throw new Error('The selected file or folder is no longer eligible for a new Item.');
  }
  const resolved = await rootEntry(root, path);
  const references = await activeReferences(context.workspace, false);
  if (references.has(resolved.canonicalPath)) {
    throw new Error('The selected file or folder already has an active Item.');
  }
  if (resolved.information.isDirectory() && config.exclude.includes(basename(path))) {
    throw new Error('The selected folder is excluded by the video widget configuration.');
  }
  if (!resolved.information.isDirectory() && !resolved.information.isFile()) {
    throw new Error('The selected path is not a regular file or folder.');
  }

  const kind: VideoEntry['kind'] = resolved.information.isDirectory() ? 'folder' : 'file';
  const entry: VideoEntry = { name: basename(path), kind, path: lexicalRelative };
  const id = randomUUID();
  const workspace = context.mutate({
    type: 'create',
    id,
    parentId: context.itemId,
    title: itemName(entry),
    patch: {
      included: true,
      notes: '',
      resourceUri: pathToFileURL(resolved.canonicalPath).href,
    },
  });
  const created = workspace.dashboard.items.find(item => item.id === id);
  if (!created) throw new Error('The video Item was created but could not be located.');
  return {
    message: `Created “${created.title}”.`,
    result: { ...(await listVideoEntries(context.config, workspace, false)), itemId: created.id },
  };
}

/** Local file/folder listing widget. Playback remains an external activity. */
export const videoWidget: WidgetDefinition = {
  summary: {
    id: 'local-video',
    title: 'Local videos',
    description: 'List immediate files and folders from a configured local media directory and create viewing Items.',
  },
  async render(input, workspace) {
    return renderDocument(await listVideoEntries(input.config, workspace, Boolean(input.snapshotId)));
  },
  actions: {
    refresh: {
      input: browseInputSchema,
      async run(_input, context) {
        return { result: await refreshListing(context) };
      },
    },
    'create-item': {
      input: createInputSchema,
      run(input, context) {
        return createItem(input, context);
      },
    },
  },
};
