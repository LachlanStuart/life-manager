import { useContext, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  MDXEditor, type MDXEditorMethods, type CodeBlockEditorProps,
  headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin,
  linkPlugin, linkDialogPlugin, imagePlugin, tablePlugin, codeBlockPlugin,
  markdownShortcutPlugin, diffSourcePlugin, toolbarPlugin,
  DiffSourceToggleWrapper, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect,
  ListsToggle, CreateLink, InsertImage, InsertTable, InsertCodeBlock,
  useCodeBlockEditorContext,
} from '@mdxeditor/editor';
import type { NotesEditorProps } from './contracts';
import { WidgetBlock, WidgetContext } from './WidgetBlock';
import '@mdxeditor/editor/style.css';
import './notes-editor.css';

function PlainCodeBlock({ code, language }: CodeBlockEditorProps) {
  const { setCode } = useCodeBlockEditorContext();
  const context = useContext(WidgetContext)!;
  const readOnly = context.readOnly ?? Boolean(context.snapshotId);
  return <div className="life-notes-code" onKeyDown={event => event.nativeEvent.stopImmediatePropagation()}>
    <label>{language || 'Plain text'}<textarea aria-label={`${language || 'Plain text'} code`} value={code} readOnly={readOnly} rows={5} spellCheck={false}
      onChange={event => setCode(event.target.value)} /></label>
  </div>;
}

function MoreNotesTools({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  return <div ref={container} className="life-notes-editor__more" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" aria-label="More notes tools" title="More notes tools" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>⋯</button>
    <div id={id} className="life-notes-editor__overflow" role="group" aria-label="Additional formatting and inserts" hidden={!open}>
      {children}
    </div>
  </div>;
}

function WidgetPicker({ insert }: { insert: (id: string) => void }) {
  const { widgets } = useContext(WidgetContext)!;
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? '');
  useEffect(() => {
    if (!widgets.some(widget => widget.id === widgetId)) setWidgetId(widgets[0]?.id ?? '');
  }, [widgets, widgetId]);
  if (!widgets.length) return null;
  return <span className="life-notes-editor__widget-picker">
    <select aria-label="Widget" value={widgetId} onChange={event => setWidgetId(event.target.value)}>
      {widgets.map(widget => <option key={widget.id} value={widget.id}>{widget.title}</option>)}
    </select>
    <button type="button" onClick={() => { if (widgetId) insert(widgetId); }}>Add widget</button>
  </span>;
}

// Remount only when the selected document changes; ordinary draft echoes keep
// the live Lexical selection and source editor intact.
export function NotesEditor(props: NotesEditorProps) {
  return <NotesDocument key={`${props.itemId}:${props.snapshotId ?? 'current'}`} {...props} />;
}

function NotesDocument(props: NotesEditorProps) {
  const { value } = props;
  const readOnly = props.readOnly ?? Boolean(props.snapshotId);
  const editor = useRef<MDXEditorMethods>(null);
  const initialMarkdown = useRef(value);
  const lastEmitted = useRef(value);
  const lastProp = useRef(value);
  const ready = useRef(false);
  const hadParseError = useRef(false);
  useEffect(() => { ready.current = true; }, []);
  const latest = useRef(props);
  latest.current = props;
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (value === lastProp.current) return;
    lastProp.current = value;
    if (value === lastEmitted.current || value === editor.current?.getMarkdown()) return;
    lastEmitted.current = value;
    editor.current?.setMarkdown(value);
  }, [value]);

  const insertMarkdown = (markdown: string) => editor.current?.focus(() => editor.current?.insertMarkdown(markdown), { defaultSelection: 'rootEnd' });

  const insertItemLink = () => {
    const id = window.prompt('Item ID')?.trim();
    if (!id) return;
    insertMarkdown(`[${id.replace(/[\\[\]]/g, '\\$&')}](/items/${encodeURIComponent(id)})`);
  };

  const plugins = useMemo(() => [
    headingsPlugin(), listsPlugin(), quotePlugin(), thematicBreakPlugin(),
    linkPlugin(), linkDialogPlugin(), tablePlugin(),
    imagePlugin({ disableImageResize: true, imageUploadHandler: async (file: File) => {
      try {
        if (!latest.current.uploadImage) throw new Error('Image uploads are unavailable. You can still insert an image URL.');
        const url = await latest.current.uploadImage(file);
        setNotice('');
        return url;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The image could not be uploaded.';
        setNotice(message);
        throw error;
      }
    } }),
    codeBlockPlugin({ defaultCodeBlockLanguage: '', codeBlockEditorDescriptors: [
      { priority: 100, match: language => language === 'life-widget', Editor: WidgetBlock },
      { priority: -10, match: () => true, Editor: PlainCodeBlock },
    ] }),
    markdownShortcutPlugin(),
    diffSourcePlugin({ viewMode: 'rich-text' }),
    toolbarPlugin({ toolbarContents: () => <DiffSourceToggleWrapper options={['rich-text', 'source']}>
      {!readOnly && <>
        <BoldItalicUnderlineToggles options={['Bold', 'Italic']} /><ListsToggle /><CreateLink />
        <MoreNotesTools>
        <UndoRedo /><BoldItalicUnderlineToggles options={['Underline']} /><BlockTypeSelect />
        <InsertImage /><InsertTable /><InsertCodeBlock />
        <button type="button" onClick={insertItemLink}>Item link</button>
        <WidgetPicker insert={id => insertMarkdown('\n```life-widget\n' + JSON.stringify({ id, config: {} }, null, 2) + '\n```\n')} />
        </MoreNotesTools>
      </>}
    </DiffSourceToggleWrapper> }),
  ], [readOnly]);

  const openItem = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    const match = url.origin === window.location.origin && /^\/items\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return;
    try { event.preventDefault(); props.onOpenItem(decodeURIComponent(match[1])); } catch { /* Invalid URL remains editable in source. */ }
  };

  return <WidgetContext.Provider value={props}>
    <div className="life-notes-editor" data-read-only={readOnly} onClickCapture={openItem}>
      {notice && <p className="life-notes-editor__notice" role="status">{notice}</p>}
      <MDXEditor ref={editor} markdown={initialMarkdown.current} readOnly={readOnly} plugins={plugins}
        contentEditableClassName="life-notes-editor__surface" placeholder="Add notes, links, images, tables, or widgets…"
        onError={() => { hadParseError.current = true; }}
        onChange={(markdown, initialNormalization) => {
          // MDXEditor keeps its initial-normalization flag after a failed import.
          // Source repairs after mount are user edits even while that flag is set.
          if ((initialNormalization && !(hadParseError.current && ready.current)) || markdown === lastEmitted.current) return;
          lastEmitted.current = markdown;
          latest.current.onChange(markdown);
        }} />
    </div>
  </WidgetContext.Provider>;
}
