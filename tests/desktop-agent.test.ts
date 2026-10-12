import { afterEach, expect, it, vi } from 'vitest';
import { sendT3Webhook } from '../src/t3-webhook';
import { sendDesktopT3 } from '../desktop/agent-launch';

vi.mock('../src/t3-webhook', () => ({ sendT3Webhook: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => vi.clearAllMocks());

it('submits the complete prompt to the configured webhook from the native process', async () => {
  expect(await sendDesktopT3('Complete prompt', 'https://hooks.example/task/token')).toEqual({ accepted: true });
  expect(sendT3Webhook).toHaveBeenCalledExactlyOnceWith('Complete prompt', 'https://hooks.example/task/token');
});

it('reports webhook failure without claiming acceptance', async () => {
  vi.mocked(sendT3Webhook).mockRejectedValueOnce(new Error('T3 unavailable'));
  expect(await sendDesktopT3('Prompt', 'https://hooks.example/task/token')).toEqual({ accepted: false, error: 'T3 unavailable' });
});
