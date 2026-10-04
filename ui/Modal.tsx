import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, onClose, children, error }: { title: string; onClose: () => void; children: ReactNode; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal?.(); ref.current?.querySelector<HTMLInputElement>('input, textarea, select')?.focus(); }, []);
  return <dialog ref={ref} className="lm-modal" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="lm-modal-heading"><h2>{title}</h2><button aria-label="Close dialog" onClick={onClose}>×</button></div>{error && <p role="alert" className="lm-error">{error}</p>}{children}
  </dialog>;
}
