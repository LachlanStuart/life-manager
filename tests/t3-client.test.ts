// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { sendT3 } from '../ui/t3-webhook';
import { api } from '../ui/api';

vi.mock('../ui/api', () => ({ api: vi.fn().mockResolvedValue({ accepted: true }) }));
afterEach(() => { delete window.lifeManagerDesktop; vi.clearAllMocks(); vi.restoreAllMocks(); });
const url = 'https://hooks.example/v1/hooks/environment/hook/token';

it('sends the full prompt and saved URL through the browser server without clipboard access', async () => {
  expect(await sendT3('Full prompt', ` ${url} `)).toEqual({ accepted: true });
  expect(api).toHaveBeenCalledExactlyOnceWith('agent/t3', { prompt: 'Full prompt', webhookUrl: url });
});

it('requires configuration and never uses an old app path', async () => {
  expect(await sendT3('Full prompt')).toMatchObject({ accepted: false, error: expect.stringContaining('Settings') });
  expect(api).not.toHaveBeenCalled();
});

it('reports failed delivery without retrying', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Webhook unavailable'));
  expect(await sendT3('Full prompt', url)).toEqual({ accepted: false, error: 'Webhook unavailable' });
  expect(api).toHaveBeenCalledTimes(1);
});

it('uses Electron on this computer, including remote workspace connections, without server fallback', async () => {
  const native = vi.fn().mockResolvedValue({ accepted: true });
  window.lifeManagerDesktop = { sendT3: native };
  expect(await sendT3('Full prompt', url)).toEqual({ accepted: true });
  expect(native).toHaveBeenCalledWith('Full prompt', url);
  native.mockRejectedValueOnce(new Error('Native failure'));
  expect(await sendT3('Full prompt', url)).toEqual({ accepted: false, error: 'Native failure' });
  expect(api).not.toHaveBeenCalled();
});

it('does not fall back to the server if the Electron preload is missing or outdated', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome Electron LifeManagerDesktop');
  expect(await sendT3('Prompt', url)).toMatchObject({ accepted: false });
  window.lifeManagerDesktop = {} as NonNullable<Window['lifeManagerDesktop']>;
  expect(await sendT3('Prompt', url)).toMatchObject({ accepted: false });
  expect(api).not.toHaveBeenCalled();
});
