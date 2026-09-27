import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { z } from 'zod';

import type { WidgetActionContext, WidgetDefinition } from '../widgets.js';

/**
 * The Twitch widget deliberately owns its OAuth state.  The state is kept in
 * the application data directory rather than in an Item, because exports and
 * Markdown notes are user-visible data and must never contain OAuth tokens.
 */
export interface TwitchWidgetOptions {
  dataDir: string;
  /** Optional default public client id. A widget config can override it. */
  publicClientId?: string;
  /** Injectable for tests and for hosts which provide a fetch implementation. */
  fetch?: typeof fetch;
  /** Injectable clock, returning the current wall-clock time. */
  now?: () => Date;
  /** Cache duration for the followed-stream listing. Defaults to one minute. */
  cacheTtlMs?: number;
}

interface TwitchConfig {
  clientId?: string;
  groups: Record<string, string>;
  groupOrder: string[];
}

interface TwitchStream {
  id?: string;
  user_id?: string;
  user_login?: string;
  user_name: string;
  game_name?: string;
  title?: string;
  started_at?: string;
  thumbnail_url?: string;
  type?: string;
  viewer_count?: number;
}

interface PersistedAuth {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  userLogin?: string;
  userDisplayName?: string;
  validatedAt: number;
}

interface PendingDeviceAuth {
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
}

interface TokenValidation {
  client_id?: string;
  login?: string;
  scopes?: string[];
  user_id?: string;
  expires_in?: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface DeviceResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface FollowedStreamsResponse {
  data?: TwitchStream[];
  pagination?: { cursor?: string };
}

type TwitchFetch = NonNullable<TwitchWidgetOptions['fetch']>;

const TWITCH_ID_URL = 'https://id.twitch.tv/oauth2';
const TWITCH_API_URL = 'https://api.twitch.tv/helix';
const REQUIRED_SCOPE = 'user:read:follows';
const AUTH_FILE = 'twitch-auth.json';
const DEFAULT_CACHE_TTL = 60_000;
const VALIDATE_INTERVAL = 60 * 60 * 1000;
const REFRESH_SAFETY_WINDOW = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_GROUP_ORDER = ['Variety Gaming', 'German', 'French', 'Chinese', 'Japanese'];

const emptyInput = z.object({}).strict();
const beginAuthInput = z.object({
  clientId: z.string().trim().min(1).max(256).optional(),
}).strict();
const createItemInput = z.object({
  userName: z.string().trim().min(1).max(100),
}).strict();

class TwitchAuthRequired extends Error {
  constructor(message = 'Connect Twitch to view followed live channels.') {
    super(message);
    this.name = 'TwitchAuthRequired';
  }
}

class TwitchUnauthorized extends Error {
  constructor(message = 'The Twitch authorization is no longer valid.') {
    super(message);
    this.name = 'TwitchUnauthorized';
  }
}

class TwitchAuthorizationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TwitchAuthorizationConfigurationError';
  }
}

class TwitchHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'TwitchHttpError';
  }
}

function text(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function textAttribute(value: unknown): string {
  return text(value).replaceAll('`', '&#96;');
}

function validClientId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 256 && !value.includes('\0');
}

function validChannelLogin(value: string): boolean {
  return /^[a-zA-Z0-9_]{1,50}$/.test(value);
}

function twitchChannelUrl(login: string): string | null {
  if (!validChannelLogin(login)) return null;
  return `https://www.twitch.tv/${encodeURIComponent(login)}`;
}

function safeVerificationUri(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const uri = new URL(value);
    if (uri.protocol !== 'https:') return null;
    if (uri.hostname !== 'twitch.tv' && uri.hostname !== 'www.twitch.tv') return null;
    if (uri.pathname !== '/activate') return null;
    return uri.toString();
  } catch {
    return null;
  }
}

function parseErrorBody(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  return typeof record.message === 'string' ? record.message : typeof record.error === 'string' ? record.error : '';
}

function formatDuration(startedAt: string | undefined, now: Date): string | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function widgetConfig(value: Record<string, unknown> | undefined): TwitchConfig {
  const rawClientId = value?.clientId;
  const clientId = validClientId(rawClientId) ? rawClientId.trim() : undefined;
  const groups: Record<string, string> = {};
  const rawGroups = value?.groups;
  if (typeof rawGroups === 'object' && rawGroups !== null && !Array.isArray(rawGroups)) {
    for (const [login, group] of Object.entries(rawGroups)) {
      if (typeof group !== 'string') continue;
      const cleanLogin = login.trim().toLowerCase();
      const cleanGroup = group.trim();
      if (cleanLogin && cleanGroup) groups[cleanLogin] = cleanGroup;
    }
  }
  const groupOrder = Array.isArray(value?.groupOrder)
    ? value!.groupOrder!.filter((group): group is string => typeof group === 'string' && group.trim().length > 0).map(group => group.trim())
    : [...DEFAULT_GROUP_ORDER];
  return { clientId, groups, groupOrder };
}

function orderGroups(groups: Map<string, TwitchStream[]>, preferredOrder: string[]): Array<[string, TwitchStream[]]> {
  const order = new Map(preferredOrder.map((group, index) => [group, index]));
  return [...groups.entries()].sort(([left], [right]) => {
    const leftIndex = order.get(left);
    const rightIndex = order.get(right);
    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    if (left === 'Ungrouped') return 1;
    if (right === 'Ungrouped') return -1;
    return left.localeCompare(right);
  });
}

function elapsedText(stream: TwitchStream, now: Date): string {
  const duration = formatDuration(stream.started_at, now);
  return duration ? `<span class="duration">${text(duration)}</span>` : '';
}

function streamCard(stream: TwitchStream, now: Date): string {
  const login = stream.user_login || stream.user_name;
  const url = twitchChannelUrl(login);
  const link = url
    ? `<a class="channel" href="${textAttribute(url)}" target="_blank" rel="noreferrer">${text(stream.user_name)}</a>`
    : `<span class="channel">${text(stream.user_name)}</span>`;
  return `<article class="stream" data-user-name="${textAttribute(stream.user_name)}">
  <div class="stream-heading">${link}<span class="stream-actions">${elapsedText(stream, now)}<button type="button" class="create icon-button" data-create="${textAttribute(stream.user_name)}" aria-label="Create Item for ${textAttribute(stream.user_name)}" title="Create Item">+</button></span></div>
  <div class="stream-title" title="${textAttribute(stream.title || 'Untitled stream')}">${text(stream.title || 'Untitled stream')}</div>
  <div class="stream-game">${text(stream.game_name || 'No category')}</div>
</article>`;
}

function feedHtml(streams: TwitchStream[], config: TwitchConfig, now: Date): string {
  const groups = new Map<string, TwitchStream[]>();
  for (const stream of streams) {
    const login = (stream.user_login || stream.user_name).toLowerCase();
    const group = config.groups[login] || 'Ungrouped';
    const list = groups.get(group) ?? [];
    list.push(stream);
    groups.set(group, list);
  }
  if (!groups.size) return '<p class="empty" role="status">No followed channels are live.</p>';
  return orderGroups(groups, config.groupOrder).map(([group, members]) => `<section class="group">
  <h3>${text(group)}</h3>
  <div class="streams">${members.map(stream => streamCard(stream, now)).join('')}</div>
</section>`).join('');
}

function setupHtml(clientId: string | undefined, message: string): string {
  return `<section class="setup" aria-label="Twitch connection">
  <p class="message" role="status">${text(message)}</p>
  <p>Register a public Twitch application, then enter its Client ID here. The secret is not needed for this device flow.</p>
  <p><a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">Open Twitch developer console</a></p>
  <label>Public Client ID <input id="client-id" maxlength="256" value="${textAttribute(clientId || '')}" autocomplete="off"></label>
  <button type="button" id="connect">Connect Twitch</button>
  <div id="device" hidden>
    <p>Open <a id="verify" target="_blank" rel="noreferrer">Twitch activation</a> and enter:</p>
    <strong id="code"></strong>
    <p id="poll-status" role="status"></p>
  </div>
</section>`;
}

function pageScript(): string {
  // The iframe bridge is supplied by WidgetBlock. Values returned by actions
  // are written with textContent and URL validation; no token enters this DOM.
  return `<script>
(() => {
  const $ = selector => document.querySelector(selector);
  const status = $('#poll-status') || $('.message');
  const setStatus = value => { if (status) status.textContent = value; };
  const call = (name, input) => window.lifeManager.action(name, input);
  const safeTwitchUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'twitch.tv' || url.hostname === 'www.twitch.tv') && url.pathname === '/activate' ? url.toString() : ''; } catch (_) { return ''; } };
  const poll = () => call('poll-auth', {}).then(async reply => {
    const result = reply && reply.result ? reply.result : {};
    if (result.status === 'authorized') { setStatus('Connected. Loading live channels…'); await window.lifeManager.refresh(); return; }
    if (result.status === 'expired' || result.status === 'denied') { setStatus(result.message || 'Twitch connection was not completed.'); return; }
    setStatus('Waiting for Twitch authorization…'); window.setTimeout(poll, Math.max(1000, result.retryAfterMs || 5000));
  }).catch(error => setStatus(error instanceof Error ? error.message : 'Twitch authorization failed.'));
  $('#connect')?.addEventListener('click', () => {
    const input = $('#client-id');
    const clientId = input && typeof input.value === 'string' ? input.value.trim() : '';
    setStatus('Starting Twitch authorization…');
    call('begin-auth', { clientId }).then(reply => {
      const result = reply && reply.result ? reply.result : {};
      const verification = safeTwitchUrl(result.verificationUri);
      if (!verification || !result.userCode) throw new Error('Twitch returned an invalid activation challenge.');
      const link = $('#verify'); if (link) { link.href = verification; link.textContent = verification; }
      const code = $('#code'); if (code) code.textContent = result.userCode;
      const device = $('#device'); if (device) device.hidden = false;
      setStatus('Waiting for Twitch authorization…'); window.setTimeout(poll, Math.max(1000, result.retryAfterMs || 1000));
    }).catch(error => setStatus(error instanceof Error ? error.message : 'Twitch authorization failed.'));
  });
  document.querySelectorAll('[data-create]').forEach(button => button.addEventListener('click', () => {
    const userName = button.getAttribute('data-create');
    if (!userName) return;
    button.disabled = true; setStatus('Creating Item…');
    call('create-item', { userName }).then(reply => { button.disabled = false; setStatus(reply && reply.message ? reply.message : 'Item created.'); }).catch(error => { button.disabled = false; setStatus(error instanceof Error ? error.message : 'Item could not be created.'); });
  }));
  $('#refresh')?.addEventListener('click', () => { setStatus('Refreshing…'); call('refresh', {}).then(() => window.lifeManager.refresh()).catch(error => setStatus(error instanceof Error ? error.message : 'Refresh failed.')); });
  $('#disconnect')?.addEventListener('click', () => { setStatus('Disconnecting…'); call('disconnect', {}).then(() => window.lifeManager.refresh()).catch(error => setStatus(error instanceof Error ? error.message : 'Disconnect failed.')); });
})();
</script>`;
}

function style(): string {
  return `<style>
body{font:14px/1.45 system-ui,sans-serif;color:CanvasText;background:Canvas;margin:0;padding:12px}button,input{font:inherit;padding:6px 9px}button{cursor:pointer}.setup{max-width:38rem}.setup p{margin:.45rem 0}.setup label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.setup input{min-width:18rem;flex:1}.group{margin:0 0 14px}.group h3{font-size:1rem;margin:0 0 6px;border-bottom:1px solid color-mix(in srgb,CanvasText 25%,transparent);padding-bottom:3px}.streams{clear:both;display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:8px}.stream{padding:8px 0;min-width:0}.stream-heading{display:flex;justify-content:space-between;gap:8px}.channel{font-weight:650}.duration{opacity:.72;white-space:nowrap}.stream-title{margin-top:3px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.stream-game{opacity:.72;font-size:.9em;min-height:1.3em}.stream-actions{display:flex;align-items:center;gap:8px}.icon-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:3px;border:0;background:transparent;border-radius:4px}.icon-button:hover{background:color-mix(in srgb,CanvasText 8%,transparent)}.icon-button svg{width:18px;height:18px}.create{font-size:22px}.empty,.message{opacity:.78}.toolbar{display:flex;gap:4px;float:right;position:sticky;top:0;z-index:1;background:Canvas;margin:0 0 6px 8px}strong{letter-spacing:.08em}
</style>`;
}

function renderDocument(body: string, authenticated: boolean): string {
  const toolbar = authenticated ? '<div class="toolbar"><button type="button" id="refresh" class="icon-button" aria-label="Refresh" title="Refresh"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/></svg></button><button type="button" id="disconnect" class="icon-button" aria-label="Disconnect" title="Disconnect"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v9M7 5a8 8 0 1 0 10 0"/></svg></button></div>' : '';
  return `${style()}${toolbar}<div id="twitch-content">${body}</div>${pageScript()}`;
}

function jsonBody(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function responseError(value: unknown, fallback: string): string {
  const message = parseErrorBody(value);
  return message || fallback;
}

export function createTwitchWidget(options: TwitchWidgetOptions): WidgetDefinition {
  const fetcher: TwitchFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());
  const cacheTtl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL;
  const authPath = join(options.dataDir, AUTH_FILE);
  let auth: PersistedAuth | null | undefined;
  let pending: PendingDeviceAuth | null = null;
  let streamCache: { fetchedAt: number; streams: TwitchStream[]; userId: string } | null = null;
  let streamRequest: Promise<TwitchStream[]> | null = null;
  let authLock: Promise<void> = Promise.resolve();

  async function withAuthLock<T>(operation: () => Promise<T>): Promise<T> {
    const prior = authLock;
    let release!: () => void;
    authLock = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function readAuth(): Promise<PersistedAuth | null> {
    if (auth !== undefined) return auth;
    try {
      const parsed: unknown = JSON.parse(await readFile(authPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Twitch authorization file is invalid.');
      const record = parsed as Record<string, unknown>;
      if (!validClientId(record.clientId) || typeof record.accessToken !== 'string' || !record.accessToken ||
          typeof record.refreshToken !== 'string' || !record.refreshToken || typeof record.expiresAt !== 'number' ||
          !Number.isFinite(record.expiresAt) || typeof record.userId !== 'string' || !record.userId ||
          typeof record.validatedAt !== 'number' || !Number.isFinite(record.validatedAt)) {
        throw new Error('Twitch authorization file is invalid.');
      }
      auth = {
        clientId: record.clientId.trim(),
        accessToken: record.accessToken,
        refreshToken: record.refreshToken,
        expiresAt: record.expiresAt,
        userId: record.userId,
        ...(typeof record.userLogin === 'string' ? { userLogin: record.userLogin } : {}),
        ...(typeof record.userDisplayName === 'string' ? { userDisplayName: record.userDisplayName } : {}),
        // Validation is process-local. A restart must validate the token once
        // before using it, even if the previous process validated it recently.
        validatedAt: 0,
      };
      return auth;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
        auth = null;
        return auth;
      }
      throw error;
    }
  }

  async function saveAuth(value: PersistedAuth): Promise<void> {
    await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
    const temporaryPath = `${authPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, jsonBody(value), { encoding: 'utf8', mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      // Refresh tokens are one-time-use credentials. Rename the complete file
      // into place so a crash cannot leave a truncated token pair behind.
      await rename(temporaryPath, authPath);
      await chmod(authPath, 0o600);
      auth = value;
    } finally {
      try { await unlink(temporaryPath); } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT')) throw error;
      }
    }
  }

  async function clearAuth(): Promise<void> {
    auth = null;
    pending = null;
    streamCache = null;
    try {
      await unlink(authPath);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT')) throw error;
    }
  }

  async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Twitch request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchWithTimeout(url, init);
    let body: unknown = null;
    try { body = await response.json(); } catch { /* An empty error response is handled below. */ }
    if (!response.ok) throw new TwitchHttpError(response.status, responseError(body, `Twitch request failed (${response.status}).`));
    return body as T;
  }

  async function validateToken(value: PersistedAuth): Promise<TokenValidation> {
    const response = await fetchWithTimeout(`${TWITCH_ID_URL}/validate`, {
      headers: { Authorization: `OAuth ${value.accessToken}` },
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* handled as an auth failure */ }
    if (response.status === 401) throw new TwitchUnauthorized();
    if (!response.ok) throw new TwitchHttpError(response.status, responseError(body, 'Twitch token validation failed.'));
    const result = body as TokenValidation;
    if (result.client_id && result.client_id !== value.clientId) throw new TwitchAuthorizationConfigurationError('The Twitch token belongs to a different Client ID.');
    if (!result.user_id || !Array.isArray(result.scopes) || !result.scopes.includes(REQUIRED_SCOPE)) {
      throw new TwitchAuthorizationConfigurationError(`Twitch authorization must include the ${REQUIRED_SCOPE} scope.`);
    }
    return result;
  }

  async function refreshAuth(value: PersistedAuth): Promise<PersistedAuth> {
    const params = new URLSearchParams({
      client_id: value.clientId,
      grant_type: 'refresh_token',
      refresh_token: value.refreshToken,
    });
    const result = await request<TokenResponse>(`${TWITCH_ID_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!result.access_token || typeof result.expires_in !== 'number' || result.expires_in <= 0) {
      throw new TwitchUnauthorized('Twitch returned an incomplete refreshed authorization.');
    }
    const refreshed: PersistedAuth = {
      ...value,
      accessToken: result.access_token,
      refreshToken: result.refresh_token || value.refreshToken,
      expiresAt: now().getTime() + result.expires_in * 1000,
      validatedAt: 0,
    };
    await saveAuth(refreshed);
    return refreshed;
  }

  async function ensureAuth(): Promise<PersistedAuth> {
    return withAuthLock(async () => {
      let value = await readAuth();
      if (!value) throw new TwitchAuthRequired();
      const currentTime = now().getTime();
      if (value.expiresAt <= currentTime + REFRESH_SAFETY_WINDOW) value = await refreshAuth(value);
      if (!value.validatedAt || currentTime - value.validatedAt >= VALIDATE_INTERVAL) {
        try {
          const validated = await validateToken(value);
          value = { ...value, userId: validated.user_id!, userLogin: validated.login, validatedAt: currentTime };
          await saveAuth(value);
        } catch (error) {
          if (!(error instanceof TwitchUnauthorized)) throw error;
          value = await refreshAuth(value);
          const validated = await validateToken(value);
          value = { ...value, userId: validated.user_id!, userLogin: validated.login, validatedAt: currentTime };
          await saveAuth(value);
        }
      }
      return value;
    });
  }

  async function followedStreams(force = false): Promise<TwitchStream[]> {
    const timestamp = now().getTime();
    if (!force && streamCache && timestamp - streamCache.fetchedAt < cacheTtl) return streamCache.streams;
    if (streamRequest) return streamRequest;
    streamRequest = (async () => {
      const value = await ensureAuth();
      try {
        const result: TwitchStream[] = [];
        let cursor: string | undefined;
        const seenCursors = new Set<string>();
        for (let page = 0; page < 100; page += 1) {
          const url = new URL(`${TWITCH_API_URL}/streams/followed`);
          url.searchParams.set('user_id', value.userId);
          url.searchParams.set('first', '100');
          if (cursor) url.searchParams.set('after', cursor);
          const response = await request<FollowedStreamsResponse>(url.toString(), {
            headers: { 'Client-ID': value.clientId, Authorization: `Bearer ${value.accessToken}` },
          });
          if (Array.isArray(response.data)) result.push(...response.data);
          const nextCursor = response.pagination?.cursor;
          if (!nextCursor || seenCursors.has(nextCursor)) break;
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
        streamCache = { fetchedAt: now().getTime(), streams: result, userId: value.userId };
        return result;
      } catch (error) {
        // Twitch requires the app to terminate a session when an API call
        // reports a revoked/invalid token. Do not keep retrying that token.
        if (error instanceof TwitchHttpError && error.status === 401) {
          await withAuthLock(async () => {
            const current = await readAuth();
            if (current?.accessToken === value.accessToken) await clearAuth();
          });
          throw new TwitchUnauthorized();
        }
        throw error;
      }
    })();
    try {
      return await streamRequest;
    } finally {
      streamRequest = null;
    }
  }

  function resolveClientId(config: TwitchConfig, supplied?: string): string | undefined {
    if (validClientId(supplied)) return supplied.trim();
    if (config.clientId) return config.clientId;
    if (validClientId(options.publicClientId)) return options.publicClientId!.trim();
    if (auth && validClientId(auth.clientId)) return auth.clientId;
    return undefined;
  }

  async function beginAuth(config: TwitchConfig, supplied?: string): Promise<WidgetActionResultValue> {
    return withAuthLock(async () => {
      const clientId = resolveClientId(config, supplied);
      if (!clientId) throw new Error('Enter a Twitch public Client ID before connecting.');
      const params = new URLSearchParams({ client_id: clientId, scopes: REQUIRED_SCOPE });
      const result = await request<DeviceResponse>(`${TWITCH_ID_URL}/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const verificationUri = safeVerificationUri(result.verification_uri);
      if (!result.device_code || !result.user_code || !verificationUri || typeof result.expires_in !== 'number' || result.expires_in <= 0) {
        throw new Error('Twitch returned an incomplete device authorization challenge.');
      }
      const intervalMs = Math.max(1000, (typeof result.interval === 'number' && result.interval > 0 ? result.interval : 5) * 1000);
      const currentTime = now().getTime();
      pending = {
        clientId,
        deviceCode: result.device_code,
        userCode: result.user_code,
        verificationUri,
        expiresAt: currentTime + result.expires_in * 1000,
        intervalMs,
        nextPollAt: currentTime,
      };
      return {
        message: 'Open Twitch activation and enter the displayed code.',
        result: { verificationUri, userCode: result.user_code, expiresIn: result.expires_in, retryAfterMs: intervalMs },
      };
    });
  }

  async function pollAuth(): Promise<WidgetActionResultValue> {
    return withAuthLock(async () => {
      if (!pending) throw new Error('Start Twitch authorization before polling.');
      const currentTime = now().getTime();
      if (currentTime >= pending.expiresAt) {
        pending = null;
        return { message: 'The Twitch authorization code expired.', result: { status: 'expired', message: 'The Twitch authorization code expired.' } };
      }
      if (currentTime < pending.nextPollAt) {
        return { result: { status: 'pending', retryAfterMs: pending.nextPollAt - currentTime } };
      }
      const params = new URLSearchParams({
        client_id: pending.clientId,
        device_code: pending.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      const response = await fetchWithTimeout(`${TWITCH_ID_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* handled below */ }
      if (!response.ok) {
        const errorRecord = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
        // Twitch documents the OAuth error code in `message`; some responses
        // use the OAuth-standard `error` field instead, so accept both.
        const errorCode = typeof errorRecord.error === 'string'
          ? errorRecord.error
          : typeof errorRecord.message === 'string' ? errorRecord.message : '';
        if (errorCode === 'authorization_pending') {
          pending.nextPollAt = currentTime + pending.intervalMs;
          return { result: { status: 'pending', retryAfterMs: pending.intervalMs } };
        }
        if (errorCode === 'slow_down') {
          pending.intervalMs += 5000;
          pending.nextPollAt = currentTime + pending.intervalMs;
          return { result: { status: 'pending', retryAfterMs: pending.intervalMs } };
        }
        if (errorCode === 'expired_token') {
          pending = null;
          return { message: 'The Twitch authorization code expired.', result: { status: 'expired', message: 'The Twitch authorization code expired.' } };
        }
        if (errorCode === 'access_denied') {
          pending = null;
          return { message: 'Twitch authorization was denied.', result: { status: 'denied', message: 'Twitch authorization was denied.' } };
        }
        throw new TwitchHttpError(response.status, responseError(body, 'Twitch authorization polling failed.'));
      }
      const token = body as TokenResponse;
      if (!token.access_token || !token.refresh_token || typeof token.expires_in !== 'number' || token.expires_in <= 0) {
        throw new Error('Twitch returned an incomplete authorization token.');
      }
      const temporary: PersistedAuth = {
        clientId: pending.clientId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: currentTime + token.expires_in * 1000,
        userId: '',
        validatedAt: 0,
      };
      const validated = await validateToken(temporary);
      const saved: PersistedAuth = {
        ...temporary,
        userId: validated.user_id!,
        userLogin: validated.login,
        validatedAt: currentTime,
      };
      await saveAuth(saved);
      pending = null;
      streamCache = null;
      return { message: 'Twitch connected.', result: { status: 'authorized', userLogin: validated.login } };
    });
  }

  function checkHistorical(context: WidgetActionContext): void {
    if (context.snapshotId) throw new Error('Twitch actions are disabled in historical snapshots.');
  }

  const definition: WidgetDefinition = {
    summary: {
      id: 'twitch-live',
      title: 'Twitch live follows',
      description: 'Show followed Twitch channels that are live, arranged by your channel groups.',
    },
    async render(input, workspace) {
      const historical = Boolean(input.snapshotId || workspace.dashboard.snapshotId);
      const config = widgetConfig(input.config);
      if (historical) return renderDocument('<p class="message" role="status">Historical snapshots do not load the current Twitch feed.</p>', false);
      const storedAuth = await readAuth();
      if (!storedAuth) return renderDocument(setupHtml(resolveClientId(config), 'Connect Twitch to view followed live channels.'), false);
      try {
        const streams = await followedStreams();
        return renderDocument(feedHtml(streams, config, now()), true);
      } catch (error) {
        const message = error instanceof TwitchAuthRequired || error instanceof TwitchUnauthorized || error instanceof TwitchAuthorizationConfigurationError
          ? error.message
          : 'The Twitch live feed could not be loaded. Try Refresh.';
        return renderDocument(setupHtml(resolveClientId(config), message), false);
      }
    },
    actions: {
      'begin-auth': {
        input: beginAuthInput,
        run(value, context) {
          checkHistorical(context);
          return beginAuth(widgetConfig(context.config), (value as { clientId?: string }).clientId);
        },
      },
      'poll-auth': {
        input: emptyInput,
        run(_value, context) {
          checkHistorical(context);
          return pollAuth();
        },
      },
      refresh: {
        input: emptyInput,
        async run(_value, context) {
          checkHistorical(context);
          streamCache = null;
          const streams = await followedStreams(true);
          return { message: `Refreshed ${streams.length} live followed channel${streams.length === 1 ? '' : 's'}.`, result: { count: streams.length } };
        },
      },
      disconnect: {
        input: emptyInput,
        async run(_value, context) {
          checkHistorical(context);
          await withAuthLock(clearAuth);
          return { message: 'Twitch disconnected.' };
        },
      },
      'create-item': {
        input: createItemInput,
        async run(value, context) {
          checkHistorical(context);
          const { userName } = value as { userName: string };
          const streams = await followedStreams();
          const stream = streams.find(candidate => candidate.user_name.toLocaleLowerCase() === userName.toLocaleLowerCase());
          if (!stream) throw new Error('That channel is no longer in the current followed live feed. Refresh and try again.');
          const login = stream.user_login || stream.user_name;
          const url = twitchChannelUrl(login);
          if (!url) throw new Error('Twitch returned an invalid channel link.');
          const workspace = context.mutate({
            type: 'create',
            parentId: context.itemId,
            title: stream.user_name,
            patch: {
              status: 'Later',
              included: true,
              notes: `[${stream.user_name} on Twitch](${url})`,
            },
          });
          return { message: `Created an Item for ${stream.user_name}.`, result: { revision: workspace.dashboard.revision } };
        },
      },
    },
  };
  return definition;
}

interface WidgetActionResultValue {
  message?: string;
  result?: unknown;
}
