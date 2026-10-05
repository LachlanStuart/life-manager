import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startServer } from '../src/server-runtime';

vi.mock('../src/server-runtime', () => ({ startServer: vi.fn() }));
vi.mock('../src/data-directory', () => ({ resolveDataDirectory: () => '/tmp/life-manager-cli-test' }));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(startServer).mockResolvedValue({
    origin: 'http://127.0.0.1:4317', host: '127.0.0.1', port: 4317,
    dataDir: '/tmp/life-manager-cli-test', stop: vi.fn(),
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'once').mockReturnValue(process);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it.each([undefined, ''])('keeps CLI access local when HOST is %s', async host => {
  vi.stubEnv('HOST', host);
  await import('../server');
  expect(startServer).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1' }));
});

it('allows explicit LAN sharing through HOST', async () => {
  vi.stubEnv('HOST', '0.0.0.0');
  await import('../server');
  expect(startServer).toHaveBeenCalledWith(expect.objectContaining({ host: '0.0.0.0' }));
});
