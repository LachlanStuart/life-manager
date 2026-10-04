import { afterEach, expect, it, vi } from 'vitest';
import { clipboard } from 'electron';
import { launchT3Conversation } from '../src/t3-launch';
import { launchDesktopT3 } from '../desktop/agent-launch';

vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/t3-launch', () => ({ launchT3Conversation: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => vi.clearAllMocks());

it('copies natively and launches in the local workspace', async () => {
  expect(await launchDesktopT3('Complete prompt', { mode: 'local', dataDir: '/local/workspace', port: 4317, shareNetwork: false }, '/default/workspace'))
    .toEqual({ copied: true, opened: true, location: 'device' });
  expect(clipboard.writeText).toHaveBeenCalledWith('Complete prompt');
  expect(launchT3Conversation).toHaveBeenCalledExactlyOnceWith('/local/workspace');
});

it('uses the local default directory for a remote connection, never the server address', async () => {
  await launchDesktopT3('Remote context prompt', { mode: 'remote', url: 'https://remote.example' }, '/client/workspace');
  expect(launchT3Conversation).toHaveBeenCalledExactlyOnceWith('/client/workspace');
});

it('reports successful copy separately from launch failure', async () => {
  vi.mocked(launchT3Conversation).mockRejectedValueOnce(new Error('T3 unavailable'));
  expect(await launchDesktopT3('Prompt', undefined, '/client/workspace')).toEqual({ copied: true, opened: false, location: 'device', error: 'T3 unavailable' });
});

it('does not launch after a clipboard failure or invalid input', async () => {
  vi.mocked(clipboard.writeText).mockImplementationOnce(() => { throw new Error('Clipboard unavailable'); });
  expect(await launchDesktopT3('Prompt', undefined, '/client/workspace')).toMatchObject({ copied: false, opened: false });
  await expect(launchDesktopT3({ prompt: 'Invalid' }, undefined, '/client/workspace')).rejects.toThrow('Invalid agent prompt');
  expect(launchT3Conversation).not.toHaveBeenCalled();
});
