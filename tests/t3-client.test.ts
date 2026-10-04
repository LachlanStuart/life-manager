// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { launchT3 } from '../ui/t3-launch';
import { copyPrompt } from '../ui/clipboard';
import { api } from '../ui/api';

vi.mock('../ui/clipboard', () => ({ copyPrompt: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../ui/api', () => ({ api: vi.fn().mockResolvedValue({ opened: true }) }));
afterEach(() => { delete window.lifeManagerDesktop; vi.clearAllMocks(); vi.restoreAllMocks(); });

it('copies in the browser before asking the server to open T3', async () => {
  expect(await launchT3('Full prompt')).toEqual({ copied: true, opened: true, location: 'server' });
  expect(copyPrompt).toHaveBeenCalledWith('Full prompt');
  expect(api).toHaveBeenCalledWith('agent/t3', {});
  expect(vi.mocked(copyPrompt).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api).mock.invocationCallOrder[0]!);
});

it('does not open a conversation when browser clipboard access fails', async () => {
  vi.mocked(copyPrompt).mockRejectedValueOnce(new Error('Denied'));
  expect(await launchT3('Full prompt')).toMatchObject({ copied: false, opened: false });
  expect(api).not.toHaveBeenCalled();
});

it('keeps copied status when the server cannot launch T3', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Start T3 first'));
  expect(await launchT3('Full prompt')).toMatchObject({ copied: true, opened: false, error: 'Start T3 first' });
});

it('uses Electron for both clipboard and launch, even when connected to a remote server', async () => {
  const native = vi.fn().mockResolvedValue({ copied: true, opened: true, location: 'device' });
  window.lifeManagerDesktop = { launchT3: native };
  expect(await launchT3('Full prompt')).toMatchObject({ location: 'device' });
  expect(native).toHaveBeenCalledWith('Full prompt');
  expect(copyPrompt).not.toHaveBeenCalled();
  expect(api).not.toHaveBeenCalled();
  native.mockRejectedValueOnce(new Error('Native failure'));
  await expect(launchT3('Full prompt')).rejects.toThrow('Native failure');
  expect(api).not.toHaveBeenCalled();
});

it('does not fall back to the server if the Electron preload is unavailable', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome Electron LifeManagerDesktop');
  expect(await launchT3('Prompt')).toMatchObject({ copied: false, opened: false, location: 'device' });
  expect(api).not.toHaveBeenCalled();
  expect(copyPrompt).not.toHaveBeenCalled();
});
