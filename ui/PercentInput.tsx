import * as React from 'react';

/** Tap to type; drag vertically to adjust. Blank restores the calculated value. */
export function PercentInput({ label, value, automatic = false, allowAuto = true, clearOnContextMenu = false, disabled, max, onSave }: {
  label: string; value: number; automatic?: boolean; allowAuto?: boolean; clearOnContextMenu?: boolean; disabled: boolean; max?: number;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const dirty = React.useRef(false);
  const gesture = React.useRef<{ id: number; y: number; value: number; next: number; active: boolean } | null>(null);
  const clamp = (n: number) => Math.max(0, Math.min(max ?? Infinity, n));
  const reset = () => { dirty.current = false; setDraft(automatic ? '' : String(value)); };
  const cancel = () => {
    const current = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (current && input.current?.hasPointerCapture?.(current.id)) input.current.releasePointerCapture(current.id);
    reset();
  };
  React.useEffect(() => {
    if (!focused && !gesture.current) reset();
  }, [value, automatic, focused]);
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) cancel(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  });
  React.useEffect(() => { if (disabled) cancel(); }, [disabled]);
  return <span className="lm-percent" data-automatic={automatic && !dragging} data-dragging={dragging}
    style={{ width: `${Math.min(8, Math.max(2, String(Math.round(value)).length, focused || dragging ? draft.length : 0)) + 2.4}ch` }}
    title={`${label}: ${Math.round(value)}%. Drag up/down or type.${allowAuto ? ' Clear to calculate automatically.' : ''}${clearOnContextMenu ? ' Right-click to clear.' : ''}`}>
    <input ref={input} aria-label={label} type="number" inputMode="decimal" min="0" max={max} step="any"
      value={focused || dragging ? draft : automatic ? '' : Math.round(value)}
      placeholder={!focused && automatic ? String(Math.round(value)) : undefined} disabled={disabled}
      onContextMenu={event => {
        if (!clearOnContextMenu || disabled) return;
        event.preventDefault(); cancel(); dirty.current = false; setDraft(''); onSave(null); event.currentTarget.blur();
      }}
      onFocus={() => { setFocused(true); reset(); }}
      onChange={event => { dirty.current = true; setDraft(event.target.value); }}
      onBlur={event => {
        setFocused(false);
        if (!dirty.current || gesture.current?.active) return;
        dirty.current = false;
        if (event.currentTarget.validity.badInput) { reset(); return; }
        const next = draft.trim() === '' ? null : Number(draft);
        if (next === null && !allowAuto) { reset(); return; }
        if (next === null || (Number.isFinite(next) && next >= 0 && (max === undefined || next <= max))) onSave(next);
        else reset();
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { event.preventDefault(); cancel(); event.currentTarget.blur(); }
      }}
      onPointerDown={event => {
        if (disabled || event.button !== 0 || gesture.current) return;
        event.preventDefault();
        const start = focused && draft.trim() && Number.isFinite(Number(draft)) ? Number(draft) : value;
        gesture.current = { id: event.pointerId, y: event.clientY, value: start, next: start, active: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const distance = current.y - event.clientY;
        if (!current.active && Math.abs(distance) < 4) return;
        current.active = true;
        current.next = clamp(Math.round(current.value + distance / 3));
        dirty.current = false;
        setDragging(true); setDraft(String(current.next));
      }}
      onPointerUp={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        gesture.current = null; setDragging(false);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (current.active) { dirty.current = false; onSave(current.next); event.currentTarget.blur(); }
        else { event.currentTarget.focus(); event.currentTarget.select(); }
      }}
      onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }} />
    <span aria-hidden="true">%</span>
  </span>;
}
