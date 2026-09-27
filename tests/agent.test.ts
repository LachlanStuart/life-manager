import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { codexDeepLink, createCodexSender, interpolatePrompt } from '../src/agent.js';
import { seedItems } from '../src/domain.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const item = { ...seedItems()[0]!, id: 'special/id', title: 'My & project' };
const template = { id: 'one', name: 'Next', prompt: 'Explore {{item.name}} at {{ item.url }}' };

describe('Codex links', () => {
  it('interpolates the selected Item and retains unknown placeholders', () => {
    expect(interpolatePrompt('{{item.name}} {{ item.id }} {{item.url}} {{other}}', item, 'https://example.ts.net:4317'))
      .toBe('My & project special/id https://example.ts.net:4317/items/special%2Fid {{other}}');
  });

  it('returns a clickable new-draft link without launching a process or claiming a task was created', async () => {
    const sender = createCodexSender({ cwd: '/workspace', apiOrigin: 'http://127.0.0.1:4317' });
    const reply = await sender.send({ item, template, origin: 'https://example.ts.net:4317' });
    const link = new URL(reply.url!);
    expect(link.protocol).toBe('codex:');
    expect(link.host + link.pathname).toBe('threads/new');
    expect([...link.searchParams.keys()]).toEqual(['prompt', 'path']);
    expect(link.searchParams.get('path')).toBe('/workspace');
    expect(link.searchParams.get('prompt')).toContain('Explore My & project at https://example.ts.net:4317/items/special%2Fid');
    expect(link.searchParams.get('prompt')).toContain('GET http://127.0.0.1:4317/api/items/special%2Fid');
    expect(reply).toEqual({ message: 'Codex link ready.', url: link.toString() });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('round-trips Unicode and query delimiters without inventing a host-selection parameter', () => {
    const prompt = 'Use & unicode ✓ # ?';
    expect(new URL(codexDeepLink(prompt, '/space with spaces')).searchParams.get('prompt')).toBe(prompt);
    expect(() => codexDeepLink(prompt, 'relative')).toThrow(/absolute path/i);
  });
});
