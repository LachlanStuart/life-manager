import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { sendT3Webhook } from '../src/t3-webhook';

const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});

it('posts the complete Unicode prompt as JSON to the configured URL', async () => {
  const received: unknown[] = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ method: request.method, url: request.url, type: request.headers['content-type'], body: JSON.parse(Buffer.concat(chunks).toString()) });
    response.writeHead(202); response.end('{"accepted":true}');
  });
  servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await sendT3Webhook('Explore 日本語\n\nFull Item context & ? #', ` http://127.0.0.1:${port}/v1/hooks/test/hook/secret `);
  expect(received).toEqual([{ method: 'POST', url: '/v1/hooks/test/hook/secret', type: 'application/json', body: { prompt: 'Explore 日本語\n\nFull Item context & ? #' } }]);
});

it.each(['', '/relative', 'file:///tmp/hook', 'ftp://example.com/hook', 'https://user:password@example.com/hook', 'https://example.com/hook#fragment'])('rejects invalid webhook URL %s before sending', async url => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(sendT3Webhook('Prompt', url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['', '   ', 'bad\0prompt', 'x'.repeat(200_001), { prompt: 'wrong type' }])('rejects invalid prompts before sending', async prompt => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(sendT3Webhook(prompt, 'https://example.com/hook')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([401, 404, 429, 500])('reports HTTP %s without exposing the secret or response body', async status => {
  const fetch = vi.fn().mockResolvedValue(new Response('Sensitive URL: /secret', { status })); vi.stubGlobal('fetch', fetch);
  await expect(sendT3Webhook('Prompt', 'https://example.com/secret')).rejects.toThrow(`T3 Code did not accept the webhook (HTTP ${status}). Check the webhook URL and task configuration in T3 Code before trying again.`);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not retry or expose transport errors and refuses redirects', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('https://example.com/private-token')); vi.stubGlobal('fetch', fetch);
  await expect(sendT3Webhook('Prompt', 'https://example.com/private-token')).rejects.toThrow('Check the webhook URL and connection');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('https://example.com/private-token', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
});
