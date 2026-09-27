import { useEffect, useRef, useState } from 'react';
import './demo-notice.css';

export function DemoNotice() {
  const [open, setOpen] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <>
    <div className="lm-demo-banner"><strong>Interactive demo</strong><span>Temporary browser storage · no export</span><button onClick={() => setOpen(true)}>About this demo</button></div>
    <dialog className="lm-demo-notice" ref={dialog} aria-labelledby="demo-title" onCancel={event => event.preventDefault()}>
      <h2 id="demo-title">Try Life Manager</h2>
      <p>This is a disposable demo with sample projects. Changes stay in this browser; they are not saved to a Life Manager server.</p>
      <p><strong>There is no way to export your data from this demo.</strong> Expect to lose it: your browser may clear website storage at any time. Clearing site data or using private browsing can also erase your changes.</p>
      <p>Please use sample content, not plans or notes you need to keep. Local files, Twitch and agent launch require the self-hosted app.</p>
      <button className="lm-primary" onClick={() => setOpen(false)}>I understand — try the demo</button>
    </dialog>
  </>;
}
