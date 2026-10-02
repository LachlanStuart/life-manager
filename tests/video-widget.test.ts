import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { mutateItems } from '../src/domain.js';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/properties.js';
import type { WidgetActionContext } from '../src/widgets.js';
import { parseVideoWidgetConfig, videoWidget } from '../src/plugins/video.js';
import type { Item, Workspace } from '../src/types.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function item(id: string, parentId: string | null, patch: Partial<Item> = {}): Item {
  return {
    id,
    parentId,
    order: 0,
    title: id,
    status: 'Later',
    notes: '',
    included: true,
    weight: 1,
    effortOverride: null,
    ...patch,
  };
}

function workspace(items: Item[], snapshotId: string | null = null): Workspace {
  return {
    dashboard: { items, periodId: 'period-1', snapshotId, revision: 0 },
    periods: [],
    snapshots: [],
    widgets: [],
    promptTemplates: [],
  };
}

function actionContext(initial: Workspace, config: Record<string, unknown>, snapshotId?: string) {
  let current = initial;
  const commands: unknown[] = [];
  const context: WidgetActionContext = {
    get workspace() { return current; },
    itemId: 'owner',
    snapshotId,
    config,
    mutate(command) {
      commands.push(command);
      current = {
        ...current,
        dashboard: {
          ...current.dashboard,
          revision: current.dashboard.revision + 1,
          items: mutateItems(current.dashboard.items, command, current.settings),
        },
      };
      return current;
    },
    async runCommand() { throw new Error('No command expected in video widget tests.'); },
  };
  return { context, commands, current: () => current };
}

async function tempMedia() {
  const root = await mkdtemp('/tmp/life-manager-video-');
  directories.push(root);
  await mkdir(join(root, '[Watched'));
  await mkdir(join(root, 'YouTube'));
  await mkdir(join(root, 'A folder'));
  await writeFile(join(root, 'Movie.mp4'), 'movie');
  await writeFile(join(root, 'README.txt'), 'ordinary file');
  await writeFile(join(root, '.hidden.mp4'), 'hidden');
  await writeFile(join(root, 'A folder', 'Nested.mp4'), 'nested');
  return root;
}

describe('local video widget', () => {
  it('requires an explicit root and defaults to no exclusions', () => {
    expect(() => parseVideoWidgetConfig(undefined)).toThrow(/root directory.*Markdown/);
    expect(() => parseVideoWidgetConfig({})).toThrow(/root directory.*Markdown/);
    expect(parseVideoWidgetConfig({ root: '/tmp/media' })).toEqual({ root: '/tmp/media', exclude: [] });
    expect(parseVideoWidgetConfig({ root: '/tmp/media', exclude: ['Archive', 'Archive'] })).toEqual({ root: '/tmp/media', exclude: ['Archive'] });
    expect(() => parseVideoWidgetConfig({ root: 'relative/media' })).toThrow(/absolute/i);
    expect(() => parseVideoWidgetConfig({ exclude: [''] })).toThrow();
  });

  it('lists only immediate non-dot regular files and folders, excluding configured folders', async () => {
    const root = await tempMedia();
    const current = workspace([item('owner', null)]);
    const listing = await videoWidget.render({ widgetId: 'local-video', itemId: 'owner', config: { root, exclude: ['[Watched', 'YouTube'] } }, current);
    expect(listing).toContain('Movie.mp4');
    expect(listing).toContain('README.txt');
    expect(listing).toContain('A folder');
    expect(listing).not.toContain('[Watched');
    expect(listing).not.toContain('YouTube');
    expect(listing).not.toContain('.hidden.mp4');
    expect(listing).not.toContain('Nested.mp4');
    expect(listing).toContain('data-video-create');
  });

  it('uses current Items, including hidden ones, to suppress active references and ignores Done/Cut and history', async () => {
    const root = await tempMedia();
    const movieUri = pathToFileURL(join(root, 'Movie.mp4')).href;
    const files = [
      item('owner', null),
      item('hidden-reference', 'owner', { included: false, resourceUri: movieUri }),
      item('done-reference', 'owner', { status: 'Done', resourceUri: pathToFileURL(join(root, 'README.txt')).href }),
      item('cut-reference', 'owner', { status: 'Cut', resourceUri: pathToFileURL(join(root, 'A folder')).href }),
    ];
    const currentHtml = await videoWidget.render({ widgetId: 'local-video', itemId: 'owner', config: { root, exclude: [] } }, workspace(files));
    expect(currentHtml).not.toContain('Movie.mp4');
    expect(currentHtml).toContain('README.txt');
    expect(currentHtml).toContain('A folder');

    const historicalHtml = await videoWidget.render({ widgetId: 'local-video', itemId: 'owner', snapshotId: 'closing-1', config: { root, exclude: [] } }, workspace(files, 'closing-1'));
    expect(historicalHtml).toContain('Movie.mp4');
    expect(historicalHtml).not.toContain('data-video-create data-path=');
  });

  it('renders names as data and text rather than executable HTML', async () => {
    const root = await mkdtemp('/tmp/life-manager-video-');
    directories.push(root);
    await writeFile(join(root, '<watch-me>.mp4'), 'movie');
    const html = await videoWidget.render({ widgetId: 'local-video', itemId: 'owner', config: { root, exclude: [] } }, workspace([item('owner', null)]));
    expect(html).toContain('&lt;watch-me&gt;.mp4');
    expect(html).not.toContain('<watch-me>');
  });

  it('rejects symlink escapes even when the link is presented as a root child', async () => {
    const root = await mkdtemp('/tmp/life-manager-video-');
    const outside = await mkdtemp('/tmp/life-manager-video-outside-');
    directories.push(root, outside);
    await writeFile(join(outside, 'secret.mp4'), 'secret');
    await symlink(join(outside, 'secret.mp4'), join(root, 'escape.mp4'));
    const html = await videoWidget.render({ widgetId: 'local-video', itemId: 'owner', config: { root, exclude: [] } }, workspace([item('owner', null)]));
    expect(html).not.toContain('escape.mp4');
    const context = actionContext(workspace([item('owner', null)]), { root, exclude: [] });
    await expect(videoWidget.actions['create-item']!.run({ path: 'escape.mp4' }, context.context)).rejects.toThrow(/eligible/i);
  });

  it('creates a child with one atomic mutation, a Later lifecycle, inclusion and a file URL', async () => {
    const root = await tempMedia();
    const canonicalRoot = await realpath(root);
    const context = actionContext(workspace([item('owner', null)]), { root, exclude: ['[Watched', 'YouTube'] });
    const reply = await videoWidget.actions['create-item']!.run({ path: 'Movie.mp4' }, context.context);
    expect(reply.message).toContain('Movie');
    expect(context.commands).toHaveLength(1);
    expect(context.commands[0]).toMatchObject({ type: 'create', parentId: 'owner', title: 'Movie', patch: {
      included: true, notes: '', resourceUri: pathToFileURL(join(canonicalRoot, 'Movie.mp4')).href,
    } });
    const created = context.current().dashboard.items.find(candidate => candidate.parentId === 'owner' && candidate.title === 'Movie');
    expect(created).toMatchObject({ status: 'Later', included: true, resourceUri: pathToFileURL(join(canonicalRoot, 'Movie.mp4')).href });
    expect((reply.result as { entries: Array<{ name: string }> }).entries.some(entry => entry.name === 'Movie.mp4')).toBe(false);

    const folderContext = actionContext(workspace([item('owner', null)]), { root, exclude: ['[Watched', 'YouTube'] });
    await videoWidget.actions['create-item']!.run({ path: 'A folder' }, folderContext.context);
    expect(folderContext.commands[0]).toMatchObject({ type: 'create', title: 'A folder', patch: { resourceUri: pathToFileURL(join(canonicalRoot, 'A folder')).href } });
  });

  it('re-checks listing eligibility so a stale or double-clicked entry cannot create two active Items', async () => {
    const root = await tempMedia();
    const context = actionContext(workspace([item('owner', null)]), { root, exclude: ['[Watched', 'YouTube'] });
    await videoWidget.actions['create-item']!.run({ path: 'Movie.mp4' }, context.context);
    await expect(videoWidget.actions['create-item']!.run({ path: 'Movie.mp4' }, context.context)).rejects.toThrow(/eligible|active/i);
    expect(context.commands).toHaveLength(1);
  });

  it('creates a fresh id when an earlier Done Item references the same file', async () => {
    const root = await tempMedia();
    const canonicalRoot = await realpath(root);
    const movieUri = pathToFileURL(join(canonicalRoot, 'Movie.mp4')).href;
    const context = actionContext(workspace([
      item('owner', null),
      item('old-done', 'owner', { title: 'Movie', status: 'Done', resourceUri: movieUri }),
    ]), { root, exclude: ['[Watched', 'YouTube'] });
    const reply = await videoWidget.actions['create-item']!.run({ path: 'Movie.mp4' }, context.context);
    const itemId = (reply.result as { itemId: string }).itemId;
    expect(itemId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(itemId).not.toBe('old-done');
    expect(context.commands[0]).toMatchObject({ type: 'create', id: itemId, title: 'Movie' });
    expect(context.current().dashboard.items.filter(candidate => candidate.title === 'Movie')).toHaveLength(2);
  });

  it('does not permit creation in historical snapshots and validates the selected path against root', async () => {
    const root = await tempMedia();
    const historical = actionContext(workspace([item('owner', null)], 'closing-1'), { root, exclude: [] }, 'closing-1');
    await expect(videoWidget.actions['create-item']!.run({ path: 'Movie.mp4' }, historical.context)).rejects.toThrow(/historical/i);
    expect(historical.commands).toHaveLength(0);

    const current = actionContext(workspace([item('owner', null)]), { root, exclude: [] });
    await expect(videoWidget.actions['create-item']!.run({ path: '../outside.mp4' }, current.context)).rejects.toThrow(/root/i);
    await expect(videoWidget.actions['create-item']!.run({ path: 'A folder/Nested.mp4' }, current.context)).rejects.toThrow(/immediate/i);
    await expect(videoWidget.actions['create-item']!.run({ path: 'does-not-exist.mp4' }, current.context)).rejects.toThrow(/eligible/i);
  });

  it('refreshes through the widget action protocol and returns data suitable for rerendering', async () => {
    const root = await tempMedia();
    const context = actionContext(workspace([item('owner', null)]), { root, exclude: ['[Watched', 'YouTube'] });
    const reply = await videoWidget.actions.refresh!.run({ path: '' }, context.context);
    expect(reply.result).toMatchObject({ root, path: '', historical: false });
    expect((reply.result as { entries: Array<{ kind: string; name: string }> }).entries).toEqual(expect.arrayContaining([
      { kind: 'folder', name: 'A folder', path: 'A folder' },
      { kind: 'file', name: 'Movie.mp4', path: 'Movie.mp4' },
      { kind: 'file', name: 'README.txt', path: 'README.txt' },
    ]));
  });
});

it('uses configured defaults for new video Items', async () => {
  const root = await tempMedia();
  const initial = workspace([item('owner', null)]);
  initial.settings = structuredClone(DEFAULT_WORKSPACE_SETTINGS);
  initial.settings.properties[0]!.defaultValue = 'Now';
  const { context, current } = actionContext(initial, { root });
  await videoWidget.actions['create-item']!.run({ path: 'Movie.mp4' }, context);
  expect(current().dashboard.items.find(item => item.parentId === 'owner')?.status).toBe('Now');
});

it('releases completed custom lifecycle references while skipped references still suppress listings', async () => {
  const root = await tempMedia();
  const initial = workspace([
    item('owner', null),
    item('complete', 'owner', { properties: { workflow: 'finished' }, resourceUri: pathToFileURL(join(root, 'Movie.mp4')).href }),
    item('skip', 'owner', { status: 'Cut', properties: { workflow: 'skipped' }, resourceUri: pathToFileURL(join(root, 'README.txt')).href }),
  ]);
  initial.settings = structuredClone(DEFAULT_WORKSPACE_SETTINGS);
  initial.settings.properties.push({ id: 'workflow', name: 'Workflow', defaultValue: null, unsetLabel: 'Unset', unsetColor: '#aabbcc', options: [
    { id: 'finished', label: 'Finished', color: '#00ff00', behavior: 'complete' },
    { id: 'skipped', label: 'Skipped', color: '#ff0000', behavior: 'skip' },
  ] });
  initial.settings.lifecyclePropertyId = 'workflow';
  const html = await videoWidget.render({ widgetId: 'local-video', itemId: 'owner', config: { root } }, initial);
  expect(html).toContain('Movie.mp4');
  expect(html).not.toContain('README.txt');
  const legacySkip = workspace([item('owner', null), item('skip', 'owner', { status: 'Skip', resourceUri: pathToFileURL(join(root, 'Movie.mp4')).href })]);
  expect(await videoWidget.render({ widgetId: 'local-video', itemId: 'owner', config: { root } }, legacySkip)).not.toContain('Movie.mp4');
});
