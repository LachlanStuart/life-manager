import { useRef, useState } from 'react';
import { Modal } from './Modal';

export function PromptDialog({ prompt, onClose }: { prompt: string; onClose: () => void }) {
  const text = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    setError(''); setCopied(false);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt);
      else {
        text.current?.focus(); text.current?.select();
        if (!document.execCommand('copy')) throw new Error('Copy unavailable');
      }
      setCopied(true);
    } catch {
      text.current?.focus(); text.current?.select();
      setError('Could not copy automatically. The full prompt is selected so you can copy it manually.');
    }
  };
  return <Modal title="Agent prompt" onClose={onClose} error={error}>
    <p>Copy this full prompt and paste it into a new conversation in your preferred app.</p>
    <label>Full prompt<textarea ref={text} rows={14} readOnly value={prompt} /></label>
    <div className="lm-modal-actions"><span role="status">{copied ? 'Copied' : ''}</span><button type="button" className="lm-primary" onClick={() => void copy()}>Copy prompt</button></div>
  </Modal>;
}
