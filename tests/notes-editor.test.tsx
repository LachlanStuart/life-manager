// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesEditor } from '../ui/NotesEditor';
import { EditorView } from '@codemirror/view';
import type { NotesEditorProps } from '../ui/contracts';
import { ThemeContext } from '../ui/theme';

beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  if (!window.matchMedia) window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function props(overrides: Partial<NotesEditorProps> = {}): NotesEditorProps {
  return { itemId: 'item-1', value: 'Hello notes', onChange: vi.fn(), widgets: [],
    renderWidget: vi.fn(async () => ({ html: '<p>Widget</p>' })),
    actWidget: vi.fn(async () => ({ message: 'Done' })), onOpenItem: vi.fn(), ...overrides };
}
const widget = (config: unknown = {}) => '```life-widget\n' + JSON.stringify({ id: 'feed', config }) + '\n```';
const feeds = [{ id: 'feed', title: 'Feed', description: 'Updates' }];

describe('Markdown NotesEditor', () => {
  it('updates editor and widget appearance without changing notes or refetching the widget', async () => {
    const initial = props({ value: widget(), widgets: feeds });
    const screen = render(<ThemeContext value="light"><NotesEditor {...initial} /></ThemeContext>);
    const frame = await screen.findByTitle('Feed widget');
    expect(frame.getAttribute('srcdoc')).toContain('color-scheme:light');
    screen.rerender(<ThemeContext value="dark"><NotesEditor {...initial} /></ThemeContext>);
    expect(frame.getAttribute('srcdoc')).toContain('color-scheme:dark');
    expect(screen.container.querySelector('.mdxeditor.dark-theme')).not.toBeNull();
    expect(initial.renderWidget).toHaveBeenCalledTimes(1);
    expect(initial.onChange).not.toHaveBeenCalled();
  });
  it('keeps common formatting visible and exposes extra tools through a dismissible overflow', async () => {
    const screen = render(<NotesEditor {...props({ widgets: feeds })} />);
    expect(screen.getByRole('radio', { name: 'Bold' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Check list' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Source mode' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Insert image' })).toBeNull();
    const more = screen.getByLabelText('More notes tools');
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add widget' })).toBeDefined();
    fireEvent.keyDown(more, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Add widget' })).toBeNull();
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    fireEvent.pointerDown(screen.container.querySelector('[contenteditable="true"]')!);
    expect(screen.queryByRole('button', { name: 'Insert image' })).toBeNull();
  });

  it('keeps the overflow open when selecting a widget or receiving an autosave echo', async () => {
    const initial = props({ widgets: [...feeds, { id: 'other', title: 'Other', description: '' }] });
    const screen = render(<NotesEditor {...initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'More notes tools' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Widget' }), { target: { value: 'other' } });
    screen.rerender(<NotesEditor {...initial} widgets={[...initial.widgets]} />);
    expect(screen.getByRole('button', { name: 'More notes tools' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    await waitFor(() => expect(vi.mocked(initial.onChange).mock.calls.at(-1)?.[0]).toContain('"id": "other"'));
  });

  it('renders required Markdown blocks through the actual editor without rewriting on load', async () => {
    const initial = props({ value: '# Heading\n\n- [x] Done\n- [ ] Next\n\n> Quoted\n\n[Related](/items/item-2)\n\n![Picture](/attachments/image.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```python\nprint(1)\n```' });
    const screen = render(<NotesEditor {...initial} />);
    expect(await screen.findByRole('heading', { name: 'Heading' })).toBeDefined();
    expect(screen.getByText('Quoted')).toBeDefined();
    expect(screen.container.querySelector('table')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'python code' })).toHaveProperty('value', 'print(1)');
    expect(initial.onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'python code' }), { target: { value: 'print(2)' } });
    await waitFor(() => expect(initial.onChange).toHaveBeenCalled());
    const markdown = vi.mocked(initial.onChange).mock.calls.at(-1)![0];
    expect(markdown).toContain('```python\nprint(2)\n```');
    expect(markdown).toContain('# Heading');
    expect(markdown).toContain('![Picture](/attachments/image.png)');
    expect(markdown).not.toContain('<table');
  });


  it('uses the native source editor to repair parse failures and save raw Markdown', async () => {
    const initial = props({ value: '<Broken' });
    const screen = render(<NotesEditor {...initial} />);
    await screen.findByText(/You can fix the errors in source mode/);
    expect(initial.onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('radio', { name: 'Diff mode' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Source mode' }));
    const source = screen.container.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(source)!;
    expect(view.state.doc.toString()).toBe('<Broken');
    await act(async () => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Repaired\n\n**Markdown**' } }); });
    expect(initial.onChange).toHaveBeenLastCalledWith('# Repaired\n\n**Markdown**');
    fireEvent.click(screen.getByRole('radio', { name: 'Rich text' }));
    expect(await screen.findByRole('heading', { name: 'Repaired' })).toBeDefined();
    expect(screen.queryByText(/You can fix the errors in source mode/)).toBeNull();
  });

  it('keeps native source selection across an autosave draft echo', async () => {
    const initial = props();
    const screen = render(<NotesEditor {...initial} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Source mode' }));
    const source = screen.container.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(source)!;
    await act(async () => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'New draft' }, selection: { anchor: 3 } }); });
    screen.rerender(<NotesEditor {...initial} value="New draft" />);
    expect(EditorView.findFromDOM(source)).toBe(view);
    expect(view.state.selection.main.head).toBe(3);
    expect(initial.onChange).toHaveBeenCalledTimes(1);
  });

  it('uploads a picked image through the native dialog and stores its attachment URL', async () => {
    const initial = props({ uploadImage: vi.fn(async () => '/attachments/tiny.png') });
    const screen = render(<NotesEditor {...initial} />);
    fireEvent.click(screen.getByLabelText('More notes tools'));
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'tiny.png', { type: 'image/png' });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: Object.assign([file], { item: (index: number) => index === 0 ? file : null }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(initial.uploadImage).toHaveBeenCalledWith(file));
    await waitFor(() => expect(vi.mocked(initial.onChange).mock.calls.at(-1)?.[0]).toContain('![](/attachments/tiny.png)'));
    expect(vi.mocked(initial.onChange).mock.calls.at(-1)?.[0]).not.toContain('data:');
  });


  it.each(['paste', 'drop'] as const)('uploads an image on %s and saves its managed URL', async eventType => {
    const initial = props({ uploadImage: vi.fn(async () => '/attachments/pasted.png') });
    const screen = render(<NotesEditor {...initial} />);
    const surface = screen.container.querySelector('[contenteditable="true"]')!;
    const file = new File(['image'], 'pasted.png', { type: 'image/png' });
    const transfer = { items: [{ type: 'image/png', kind: 'file', getAsFile: () => file }], files: [file], getData: () => '' };
    if (eventType === 'paste') fireEvent.paste(surface, { clipboardData: transfer });
    else fireEvent.drop(surface, { dataTransfer: transfer });
    await waitFor(() => expect(initial.uploadImage).toHaveBeenCalledWith(file));
    await waitFor(() => expect(vi.mocked(initial.onChange).mock.calls.at(-1)?.[0]).toContain('![](/attachments/pasted.png)'));
  });

  it('accepts external updates and keeps the surface during draft echoes', async () => {
    const initial = props();
    const screen = render(<NotesEditor {...initial} />);
    const surface = screen.container.querySelector('[contenteditable="true"]');
    screen.rerender(<NotesEditor {...initial} value="Changed elsewhere" />);
    await screen.findByText('Changed elsewhere');
    expect(screen.container.querySelector('[contenteditable="true"]')).toBe(surface);
    expect(initial.onChange).not.toHaveBeenCalled();
  });

  it('opens ordinary item deep links and makes historical content read-only', async () => {
    const initial = props({ snapshotId: 'snapshot-1', value: '[Related item](/items/item%202)\n\n```custom\nkeep source\n```' });
    const screen = render(<NotesEditor {...initial} />);
    fireEvent.click(await screen.findByText('Related item'));
    expect(initial.onOpenItem).toHaveBeenCalledWith('item 2');
    expect(screen.container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'custom code' })).toHaveProperty('readOnly', true);
  });

  it('retains malformed widget config and repairs nested JSON as Markdown', async () => {
    const initial = props({ value: '```life-widget\n{"id": broken\n```', widgets: feeds });
    const screen = render(<NotesEditor {...initial} />);
    const source = await screen.findByRole('textbox', { name: 'Widget configuration JSON' });
    expect(source).toHaveProperty('value', '{"id": broken');
    expect(initial.onChange).not.toHaveBeenCalled();
    fireEvent.change(source, { target: { value: JSON.stringify({ id: 'feed', config: { filters: { topics: ['language'] } } }) } });
    await waitFor(() => expect(initial.renderWidget).toHaveBeenCalledWith({ itemId: 'item-1', widgetId: 'feed', config: { filters: { topics: ['language'] } } }));
    expect(vi.mocked(initial.onChange).mock.calls.at(-1)![0]).toContain('```life-widget');
    expect(vi.mocked(initial.onChange).mock.calls.at(-1)![0]).not.toContain('<iframe');
  });

  it('retains unavailable widget source without calling a missing renderer', async () => {
    const initial = props({ value: widget({ nested: { value: 1 } }) });
    const screen = render(<NotesEditor {...initial} />);
    expect(await screen.findByText('Widget unavailable. Configuration retained.')).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Widget configuration JSON' })).toHaveProperty('value', '{"id":"feed","config":{"nested":{"value":1}}}');
    expect(initial.renderWidget).not.toHaveBeenCalled();
  });

  it('accepts actions only from its own frame and correlates each request once', async () => {
    const initial = props({ value: widget({ nested: { value: 1 } }), widgets: feeds });
    const screen = render(<NotesEditor {...initial} />);
    const frame = await screen.findByTitle('Feed widget') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.srcdoc).toContain('event.source !== parent');
    const reply = vi.spyOn(frame.contentWindow!, 'postMessage');
    const data = { source: 'life-manager-widget', version: 1, kind: 'action', requestId: 'request-1', action: 'refresh', input: { limit: 2 } };
    window.dispatchEvent(new MessageEvent('message', { data, source: window }));
    window.dispatchEvent(new MessageEvent('message', { data: { ...data, requestId: '' }, source: frame.contentWindow }));
    expect(initial.actWidget).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
      window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
    });
    expect(initial.actWidget).toHaveBeenCalledTimes(1);
    expect(initial.actWidget).toHaveBeenCalledWith({ widgetId: 'feed', itemId: 'item-1', config: { nested: { value: 1 } }, action: 'refresh', input: { limit: 2 } });
    expect(reply).toHaveBeenCalledWith({ source: 'life-manager-host', version: 1, requestId: 'request-1', kind: 'result', result: { message: 'Done' } }, '*');
  });

  it('refreshes widget HTML through the renderer instead of replaying the old iframe document', async () => {
    const initial = props({ value: widget({ groups: { one: 'French' } }), widgets: feeds });
    vi.mocked(initial.renderWidget).mockResolvedValueOnce({ html: '<p>Connect</p>' }).mockResolvedValue({ html: '<p>Live channels</p>' });
    const screen = render(<NotesEditor {...initial} />);
    const frame = await screen.findByTitle('Feed widget') as HTMLIFrameElement;
    const data = { source: 'life-manager-widget', version: 1, kind: 'refresh', requestId: 'refresh-1' };
    window.dispatchEvent(new MessageEvent('message', { source: window, data }));
    expect(initial.renderWidget).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data })); });
    const next = await screen.findByTitle('Feed widget') as HTMLIFrameElement;
    expect(next).not.toBe(frame);
    expect(next.srcdoc).toContain('Live channels');
    expect(initial.renderWidget).toHaveBeenLastCalledWith({ widgetId: 'feed', itemId: 'item-1', config: { groups: { one: 'French' } } });
    expect(initial.actWidget).not.toHaveBeenCalled();
  });

  it('blocks historical widget actions even when note corrections are enabled', async () => {
    const initial = props({ value: widget(), widgets: feeds, snapshotId: 'snapshot-1', readOnly: false });
    const screen = render(<NotesEditor {...initial} />);
    const frame = await screen.findByTitle('Feed widget') as HTMLIFrameElement;
    const reply = vi.spyOn(frame.contentWindow!, 'postMessage');
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { source: 'life-manager-widget', version: 1, kind: 'action', requestId: 'history-action', action: 'refresh' } }));
    expect(initial.actWidget).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', requestId: 'history-action' }), '*');
  });
});
