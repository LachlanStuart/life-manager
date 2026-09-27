import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCodeBlockEditorContext, type CodeBlockEditorProps } from '@mdxeditor/editor';
import type { NotesEditorProps } from './contracts';

export const WidgetContext = createContext<NotesEditorProps | null>(null);
const HOST = 'life-manager-host';
const WIDGET = 'life-manager-widget';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function documentFor(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>body{margin:0;padding:12px;font:14px/1.5 system-ui;color:#34332e}img{max-width:100%}</style><script>
(() => {
  const pending = new Map(); let sequence = 0;
  const send = (kind, action, input) => {
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + ':' + (++sequence);
      pending.set(requestId, { resolve, reject });
      parent.postMessage({source:'${WIDGET}',version:1,kind,requestId,action,input}, '*');
    });
  };
  window.lifeManager = Object.freeze({ action: (action, input) => send('action', action, input), refresh: () => send('refresh') });
  addEventListener('message', event => {
    const m = event.data;
    if (event.source !== parent || !m || m.source !== '${HOST}' || m.version !== 1 ||
        (m.kind !== 'result' && m.kind !== 'error') || typeof m.requestId !== 'string') return;
    const request = pending.get(m.requestId); if (!request) return;
    pending.delete(m.requestId);
    if (m.kind === 'result') request.resolve(m.result);
    else request.reject(new Error(m.error || 'Widget action failed'));
  });
})();
</script></head><body>${html}</body></html>`;
}

export function WidgetBlock({ code }: CodeBlockEditorProps) {
  const context = useContext(WidgetContext)!;
  const { setCode } = useCodeBlockEditorContext();
  const latest = useRef(context);
  latest.current = context;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [document, setDocument] = useState('');
  const [frameVersion, setFrameVersion] = useState(0);
  const [status, setStatus] = useState('');
  const parsed = useMemo(() => {
    try {
      const value: unknown = JSON.parse(code);
      return record(value) && typeof value.id === 'string' && value.id && (value.config === undefined || record(value.config))
        ? { id: value.id, config: (value.config ?? {}) as Record<string, unknown> }
        : null;
    } catch { return null; }
  }, [code]);
  const summary = context.widgets.find(widget => widget.id === parsed?.id);
  const known = Boolean(summary);
  const readOnly = context.readOnly ?? Boolean(context.snapshotId);

  useEffect(() => {
    let mounted = true;
    setDocument('');
    if (!parsed || !known) return;
    setStatus('Loading…');
    void latest.current.renderWidget({ widgetId: parsed.id, config: parsed.config,
      itemId: context.itemId, ...(context.snapshotId ? { snapshotId: context.snapshotId } : {})
    }).then(result => {
      if (mounted) { setDocument(documentFor(result.html)); setStatus(''); }
    }, error => {
      if (mounted) setStatus(error instanceof Error ? error.message : 'Widget could not load.');
    });
    return () => { mounted = false; };
  }, [parsed, known, context.itemId, context.snapshotId]);

  useEffect(() => {
    let mounted = true;
    const seen = new Set<string>();
    const onMessage = (event: MessageEvent<unknown>) => {
      const frame = frameRef.current;
      const message = event.data;
      if (!frame?.isConnected || event.source !== frame.contentWindow || !parsed || !known || !record(message)) return;
      if (message.source !== WIDGET || message.version !== 1 || !['action', 'refresh'].includes(String(message.kind)) ||
          typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 256) return;
      if (message.kind === 'action' && (typeof message.action !== 'string' || !message.action || message.action.length > 256)) return;
      try { if (JSON.stringify(message).length > 64 * 1024) return; } catch { return; }
      if (seen.has(message.requestId)) return;
      seen.add(message.requestId);
      const requestId = message.requestId;
      const reply = (body: Record<string, unknown>) => {
        if (mounted && frame.isConnected) frame.contentWindow?.postMessage({ source: HOST, version: 1, requestId, ...body }, '*');
      };
      const current = latest.current;
      if (message.kind === 'refresh') {
        void current.renderWidget({ widgetId: parsed.id, config: parsed.config, itemId: current.itemId,
          ...(current.snapshotId ? { snapshotId: current.snapshotId } : {})
        }).then(result => {
          if (!mounted) return;
          reply({ kind: 'result', result: {} });
          setDocument(documentFor(result.html));
          setFrameVersion(version => version + 1);
        }, error => reply({ kind: 'error', error: error instanceof Error ? error.message : 'Widget refresh failed' }));
        return;
      }
      if ((current.readOnly ?? Boolean(current.snapshotId)) || current.snapshotId) {
        reply({ kind: 'error', error: 'Widget actions are disabled in historical or read-only notes.' });
        return;
      }
      void current.actWidget({ widgetId: parsed.id, config: parsed.config, itemId: current.itemId,
        action: message.action as string, ...(message.input === undefined ? {} : { input: message.input })
      }).then(result => reply({ kind: 'result', result }), error => reply({ kind: 'error', error: error instanceof Error ? error.message : 'Widget action failed' }));
    };
    window.addEventListener('message', onMessage);
    return () => { mounted = false; window.removeEventListener('message', onMessage); };
  }, [parsed, known, document]);

  return <div className="life-notes-widget" data-widget-id={parsed?.id} contentEditable={false} onKeyDown={event => event.nativeEvent.stopImmediatePropagation()}>
    <div className="life-notes-widget__heading"><strong>{summary?.title ?? parsed?.id ?? 'Widget'}</strong>
      <span role="status">{!parsed ? 'Invalid widget configuration. Edit the JSON to repair it.' : !known ? 'Widget unavailable. Configuration retained.' : status}</span>
    </div>
    {parsed && known && document ? <iframe key={frameVersion} ref={frameRef} title={`${summary?.title} widget`} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={document} className="life-notes-widget__frame" /> : null}
    <details open={!parsed || !known}><summary>Widget configuration</summary>
      <textarea aria-label="Widget configuration JSON" value={code} readOnly={readOnly} rows={5} spellCheck={false}
        onChange={event => setCode(event.target.value)} />
    </details>
  </div>;
}
