import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { PROPERTY_COLORS } from './property-colors';
import './color-picker.css';

export function ColorPicker({ label, value, disabled = false, onChange }: {
  label: string; value: string; disabled?: boolean; onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = open && !disabled;
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };

  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const rect = popup.current!.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(anchor.left, innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(anchor.bottom + 6, innerHeight - rect.height - 8)),
      });
    };
    place();
    const selected = popup.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?? popup.current?.querySelector<HTMLButtonElement>('.lm-color-picker__palette button');
    selected?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [visible]);

  return <div className="lm-color-picker" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="lm-color-picker__trigger" aria-label={label}
      title={`${label}: ${value}`} aria-haspopup="dialog" aria-expanded={visible} aria-controls={visible ? id : undefined}
      disabled={disabled} onClick={() => setOpen(current => !current)}>
      <span style={{ background: value }} />
    </button>
    {visible && <div ref={popup} id={id} role="dialog" aria-label={label} className="lm-color-picker__popup" style={position}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="lm-color-picker__heading"><strong>{label}</strong><button type="button" aria-label="Close color picker" onClick={close}>×</button></div>
      <div className="lm-color-picker__palette" role="group" aria-label="Palette colors">
        {PROPERTY_COLORS.map(color => <button key={color.value} type="button" title={`${color.name} (${color.value})`}
          aria-label={color.name} aria-pressed={value.toLowerCase() === color.value}
          style={{ background: color.value }} onClick={() => { onChange(color.value); close(); }}>
          {value.toLowerCase() === color.value && <span aria-hidden="true">✓</span>}
        </button>)}
      </div>
      <label className="lm-color-picker__custom">Custom color<input type="color" aria-label={`${label} custom color`} value={value} onChange={event => onChange(event.target.value)} /></label>
    </div>}
  </div>;
}
