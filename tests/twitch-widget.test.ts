import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTwitchWidget } from '../src/plugins/twitch.js';
import type { WidgetActionContext, WidgetDefinition } from '../src/widgets.js';
import type { Item, Workspace } from '../src/types.js';

interface TestDom {
  window: { document: Document; close(): void };
}

interface TestDomConstructor {
  new (html: string, options: { runScripts: 'dangerously'; beforeParse(window: unknown): void }): TestDom;
}

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: TestDomConstructor };
const directories: string[] = [];
const documents: TestDom[] = [];
afterEach(async () => {
  for (const document of documents.splice(0).reverse()) document.window.close();
  for (const directory of directories.splice(0).reverse()) await rm(directory, { recursive: true, force: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function workspace(items: Item[] = []): Workspace {
  return {
    dashboard: { items, periodId: 'period-1', snapshotId: null, revision: 0 },
    periods: [], snapshots: [], widgets: [], promptTemplates: [],
  };
}

function rootItem(): Item {
  return {
    id: 'enjoy', parentId: null, order: 0, title: 'Enjoy', status: 'Later', notes: '',
    included: true, weight: 1, effortOverride: null,
  };
}

function context(value: Workspace, config: Record<string, unknown> = {}, snapshotId?: string): WidgetActionContext {
  return {
    workspace: value,
    itemId: 'enjoy',
    ...(snapshotId ? { snapshotId } : {}),
    config,
    mutate: vi.fn(() => value),
    runCommand: vi.fn(async () => ({ stdout: '', stderr: '' })),
  };
}

async function action(widget: WidgetDefinition, name: string, input: unknown, value: Workspace, config: Record<string, unknown> = {}, snapshotId?: string) {
  const definition = widget.actions[name];
  if (!definition) throw new Error(`Missing action ${name}`);
  return definition.run(definition.input.parse(input), context(value, config, snapshotId));
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'life-manager-twitch-'));
  directories.push(directory);
  return directory;
}

async function seedAuth(directory: string, overrides: Partial<Record<string, unknown>> = {}) {
  const value = {
    clientId: 'client-id', accessToken: 'access-token', refreshToken: 'refresh-token',
    expiresAt: Date.now() + 3_600_000, userId: 'user-1', userLogin: 'sample_viewer', validatedAt: Date.now(),
    ...overrides,
  };
  const path = join(directory, 'twitch-auth.json');
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await chmod(path, 0o600);
  return value;
}

function fetchMock(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call.url, call.init);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('Twitch live follows widget', () => {
  it('completes device authorization, stores secrets privately, and never renders them', async () => {
    const directory = await temporaryDirectory();
    let nowMs = Date.parse('2026-09-15T12:00:00Z');
    let polls = 0;
    const { calls, fetcher } = fetchMock((url, init) => {
      if (url.endsWith('/oauth2/device')) {
        expect(init.method).toBe('POST');
        expect(init.body).toContain('client_id=public-client');
        expect(init.body).toContain('scopes=user%3Aread%3Afollows');
        return json({ device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate', expires_in: 600, interval: 1 });
      }
      if (url.endsWith('/oauth2/token')) {
        polls += 1;
        if (polls === 1) return json({ error: 'authorization_pending' }, 400);
        return json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, token_type: 'bearer' });
      }
      if (url.endsWith('/oauth2/validate')) {
        expect(init.headers).toMatchObject({ Authorization: 'OAuth access-secret' });
        return json({ client_id: 'public-client', login: 'sample_viewer', scopes: ['user:read:follows'], user_id: 'user-1', expires_in: 3600 });
      }
      if (url.includes('/streams/followed')) return json({ data: [] });
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher, now: () => new Date(nowMs) });
    const value = workspace([rootItem()]);
    const config = { clientId: 'public-client' };

    const before = await widget.render({ widgetId: 'twitch-live', itemId: 'enjoy', config }, value);
    expect(before).toContain('Connect Twitch');
    expect(before).not.toContain('device-secret');
    const script = before.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
    const begin = await action(widget, 'begin-auth', {}, value, config);
    expect(begin.result).toEqual(expect.objectContaining({ verificationUri: 'https://www.twitch.tv/activate', userCode: 'ABCD-EFGH' }));
    expect(JSON.stringify(begin)).not.toContain('device-secret');

    const pending = await action(widget, 'poll-auth', {}, value, config);
    expect(pending.result).toEqual(expect.objectContaining({ status: 'pending' }));
    nowMs += 1000;
    const authorized = await action(widget, 'poll-auth', {}, value, config);
    expect(authorized.result).toMatchObject({ status: 'authorized', userLogin: 'sample_viewer' });

    const rendered = await widget.render({ widgetId: 'twitch-live', itemId: 'enjoy', config }, value);
    expect(rendered).toContain('No followed channels are live.');
    expect(rendered).not.toContain('access-secret');
    expect(rendered).not.toContain('refresh-secret');
    expect(rendered).not.toContain('device-secret');
    const saved = JSON.parse(await readFile(join(directory, 'twitch-auth.json'), 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({ accessToken: 'access-secret', refreshToken: 'refresh-secret', userId: 'user-1' });
    expect((await stat(join(directory, 'twitch-auth.json'))).mode & 0o777).toBe(0o600);
    expect(calls.filter(call => call.url.endsWith('/oauth2/token'))).toHaveLength(2);
  });

  it('requests and enforces the followed-stream scope during device authorization', async () => {
    const directory = await temporaryDirectory();
    const { fetcher } = fetchMock(url => {
      if (url.endsWith('/oauth2/device')) return json({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 600, interval: 1 });
      if (url.endsWith('/oauth2/token')) return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
      if (url.endsWith('/oauth2/validate')) return json({ client_id: 'client-id', user_id: 'user-1', scopes: [] });
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher });
    const value = workspace([rootItem()]);
    await action(widget, 'begin-auth', {}, value, { clientId: 'client-id' });
    await expect(action(widget, 'poll-auth', {}, value, { clientId: 'client-id' })).rejects.toThrow('user:read:follows');
    await expect(readFile(join(directory, 'twitch-auth.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('handles slow-down and enforces the server-side polling interval', async () => {
    const directory = await temporaryDirectory();
    let nowMs = Date.parse('2026-09-15T12:00:00Z');
    let tokenCalls = 0;
    const { calls, fetcher } = fetchMock(url => {
      if (url.endsWith('/oauth2/device')) return json({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 600, interval: 1 });
      if (url.endsWith('/oauth2/token')) {
        tokenCalls += 1;
        if (tokenCalls === 1) return json({ message: 'slow_down' }, 400);
        return json({ error: 'expired_token' }, 400);
      }
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher, now: () => new Date(nowMs) });
    const value = workspace([rootItem()]);
    await action(widget, 'begin-auth', {}, value, { clientId: 'client-id' });
    const slowed = await action(widget, 'poll-auth', {}, value, { clientId: 'client-id' });
    expect(slowed.result).toMatchObject({ status: 'pending', retryAfterMs: 6000 });
    const early = await action(widget, 'poll-auth', {}, value, { clientId: 'client-id' });
    expect(early.result).toMatchObject({ status: 'pending', retryAfterMs: 6000 });
    expect(calls.filter(call => call.url.endsWith('/oauth2/token'))).toHaveLength(1);
    nowMs += 6000;
    const expired = await action(widget, 'poll-auth', {}, value, { clientId: 'client-id' });
    expect(expired.result).toMatchObject({ status: 'expired' });
    expect(calls.filter(call => call.url.endsWith('/oauth2/token'))).toHaveLength(2);
  });

  it('fetches all followed-stream pages and groups only groups represented by live channels', async () => {
    const directory = await temporaryDirectory();
    const nowMs = Date.parse('2026-09-15T12:00:00Z');
    await seedAuth(directory, { expiresAt: nowMs + 3_600_000, validatedAt: nowMs });
    let streamPage = 0;
    const { calls, fetcher } = fetchMock((url, init) => {
      if (url.endsWith('/oauth2/validate')) return json({ client_id: 'client-id', login: 'sample_viewer', scopes: ['user:read:follows'], user_id: 'user-1' });
      if (url.includes('/streams/followed')) {
        expect(init.headers).toMatchObject({ 'Client-ID': 'client-id', Authorization: 'Bearer access-token' });
        streamPage += 1;
        if (streamPage === 1) return json({ data: [
          { user_login: 'de_login', user_name: 'De Streamer', title: 'German title with "quotes" & details', game_name: 'Game A', started_at: '2026-09-15T10:59:00Z' },
          { user_login: 'fr_login', user_name: 'Fr Streamer', title: 'French title', game_name: 'Game B' },
        ], pagination: { cursor: 'page-2' } });
        return json({ data: [{ user_login: 'unknown', user_name: 'Unknown', title: 'Other title', game_name: 'Game C', started_at: 'invalid' }] });
      }
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher, now: () => new Date(nowMs) });
    const value = workspace([rootItem()]);
    const config = { groups: { de_login: 'German', fr_login: 'French', absent: 'Japanese' }, groupOrder: ['French', 'German', 'Japanese'] };
    const rendered = await widget.render({ widgetId: 'twitch-live', itemId: 'enjoy', config }, value);
    expect(rendered.indexOf('<h3>French</h3>')).toBeGreaterThanOrEqual(0);
    expect(rendered.indexOf('<h3>German</h3>')).toBeGreaterThan(rendered.indexOf('<h3>French</h3>'));
    expect(rendered.indexOf('<h3>Ungrouped</h3>')).toBeGreaterThan(rendered.indexOf('<h3>German</h3>'));
    expect(rendered).not.toContain('<h3>Japanese</h3>');
    expect(rendered).toContain('German title');
    expect(rendered).toContain('Game A');
    expect(rendered).toContain('1h 1m');
    expect(rendered).toContain('https://www.twitch.tv/de_login');
    expect(rendered).toContain('aria-label="Create Item for De Streamer" title="Create Item">+</button>');
    expect(rendered).toContain('title="German title with &quot;quotes&quot; &amp; details"');
    expect(rendered).toContain('aria-label="Refresh"');
    expect(rendered).toContain('aria-label="Disconnect"');
    expect(rendered).not.toContain('Live followed channels');
    expect(calls.filter(call => call.url.includes('/streams/followed'))).toHaveLength(2);
    const streamCallsSeen = calls.filter(call => call.url.includes('/streams/followed'));
    expect(streamCallsSeen[0]?.url).toContain('user_id=user-1');
    expect(streamCallsSeen[1]?.url).toContain('after=page-2');
  });

  it('serializes refreshes and validates an expired access token before fetching streams', async () => {
    const directory = await temporaryDirectory();
    const nowMs = Date.parse('2026-09-15T12:00:00Z');
    await seedAuth(directory, { expiresAt: nowMs - 1, validatedAt: nowMs - 3_600_001 });
    let refreshCalls = 0;
    let validateCalls = 0;
    let streamCalls = 0;
    const { fetcher } = fetchMock((url, init) => {
      if (url.endsWith('/oauth2/token')) {
        refreshCalls += 1;
        expect(init.body).toContain('refresh_token=refresh-token');
        return new Promise(resolve => setTimeout(() => resolve(json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })), 10));
      }
      if (url.endsWith('/oauth2/validate')) {
        validateCalls += 1;
        expect(init.headers).toMatchObject({ Authorization: 'OAuth new-access' });
        return json({ client_id: 'client-id', login: 'sample_viewer', scopes: ['user:read:follows'], user_id: 'user-1' });
      }
      if (url.includes('/streams/followed')) {
        streamCalls += 1;
        expect(init.headers).toMatchObject({ Authorization: 'Bearer new-access' });
        return json({ data: [] });
      }
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher, now: () => new Date(nowMs) });
    const value = workspace([rootItem()]);
    await Promise.all([
      widget.render({ widgetId: 'twitch-live', itemId: 'enjoy' }, value),
      widget.render({ widgetId: 'twitch-live', itemId: 'enjoy' }, value),
    ]);
    expect(refreshCalls).toBe(1);
    expect(validateCalls).toBe(1);
    expect(streamCalls).toBe(1);
    const saved = JSON.parse(await readFile(join(directory, 'twitch-auth.json'), 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('creates a fresh ordinary child only for a channel in the current or cached feed', async () => {
    const directory = await temporaryDirectory();
    await seedAuth(directory);
    const { fetcher } = fetchMock(url => {
      if (url.endsWith('/oauth2/validate')) return json({ client_id: 'client-id', login: 'sample_viewer', scopes: ['user:read:follows'], user_id: 'user-1' });
      if (url.includes('/streams/followed')) return json({ data: [{ user_login: 'alice_login', user_name: 'Alice', title: 'Live now', game_name: 'Game' }] });
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher });
    const value = workspace([rootItem()]);
    const mutate = vi.fn((command) => ({ ...value, dashboard: { ...value.dashboard, revision: value.dashboard.revision + 1, items: [...value.dashboard.items, {
      id: 'new-item', parentId: command.type === 'create' ? command.parentId : null, order: 1, title: command.type === 'create' ? command.title : '', status: 'Later' as const,
      notes: command.type === 'create' ? command.patch?.notes || '' : '', included: true, weight: 1, effortOverride: null,
    }] } }));
    const actionContext = context(value);
    actionContext.mutate = mutate;
    const definition = widget.actions['create-item']!;
    const result = await definition.run(definition.input.parse({ userName: 'alice' }), actionContext);
    expect(result.message).toContain('Alice');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'create', parentId: 'enjoy', title: 'Alice',
      patch: { status: 'Later', included: true, notes: '[Alice on Twitch](https://www.twitch.tv/alice_login)' },
    }));
    await expect(definition.run(definition.input.parse({ userName: 'not-followed' }), actionContext)).rejects.toThrow('no longer');
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('does not fetch or mutate while rendering or acting on historical snapshots', async () => {
    const directory = await temporaryDirectory();
    const { fetcher } = fetchMock(() => { throw new Error('Twitch must not be contacted for a historical snapshot.'); });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher });
    const value = workspace([rootItem()]);
    const rendered = await widget.render({ widgetId: 'twitch-live', itemId: 'enjoy', snapshotId: 'snapshot-1' }, value);
    expect(rendered).toContain('Historical snapshots do not load the current Twitch feed.');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(action(widget, 'refresh', {}, value, {}, 'snapshot-1')).rejects.toThrow('historical');
    await expect(action(widget, 'create-item', { userName: 'alice' }, value, {}, 'snapshot-1')).rejects.toThrow('historical');
  });

  it('uses the host refresh bridge after device authorization completes', async () => {
    const directory = await temporaryDirectory();
    const { fetcher } = fetchMock(url => {
      if (url.endsWith('/oauth2/device')) return json({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 600, interval: 1 });
      if (url.endsWith('/oauth2/token')) return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
      if (url.endsWith('/oauth2/validate')) return json({ client_id: 'client-id', user_id: 'user-1', login: 'sample_viewer', scopes: ['user:read:follows'] });
      if (url.includes('/streams/followed')) return json({ data: [] });
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher });
    const value = workspace([rootItem()]);
    const actionCalls: unknown[][] = [];
    const refresh = vi.fn(async () => undefined);
    const actionBridge = vi.fn(async (name: string, input: unknown) => {
      actionCalls.push([name, input]);
      if (name === 'begin-auth') return { result: { verificationUri: 'https://www.twitch.tv/activate', userCode: 'CODE', retryAfterMs: 1 } };
      if (name === 'poll-auth') return { result: { status: 'authorized' } };
      throw new Error(`Unexpected widget action: ${name}`);
    });
    const html = await widget.render({ widgetId: 'twitch-live', itemId: 'enjoy', config: { clientId: 'client-id' } }, value);
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      beforeParse(window: unknown) { (window as { lifeManager?: unknown }).lifeManager = { action: actionBridge, refresh }; },
    });
    documents.push(dom);
    (dom.window.document.querySelector('#connect') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 1_100));
    expect(actionCalls.map(([name]) => name)).toEqual(['begin-auth', 'poll-auth']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes the host after a live-feed refresh action', async () => {
    const directory = await temporaryDirectory();
    await seedAuth(directory);
    const { fetcher } = fetchMock(url => {
      if (url.endsWith('/oauth2/validate')) return json({ client_id: 'client-id', user_id: 'user-1', login: 'sample_viewer', scopes: ['user:read:follows'] });
      if (url.includes('/streams/followed')) return json({ data: [] });
      throw new Error(`Unexpected Twitch URL: ${url}`);
    });
    const widget = createTwitchWidget({ dataDir: directory, fetch: fetcher });
    const value = workspace([rootItem()]);
    const actionBridge = vi.fn(async () => ({ message: 'Refreshed.' }));
    const refresh = vi.fn(async () => undefined);
    const html = await widget.render({ widgetId: 'twitch-live', itemId: 'enjoy' }, value);
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      beforeParse(window: unknown) { (window as { lifeManager?: unknown }).lifeManager = { action: actionBridge, refresh }; },
    });
    documents.push(dom);
    (dom.window.document.querySelector('#refresh') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(actionBridge).toHaveBeenCalledTimes(1);
    expect(actionBridge).toHaveBeenCalledWith('refresh', {});
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
