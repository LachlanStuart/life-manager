import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STATUSES, type Item } from '../src/types';

export function ItemContextMenu({ item, x, y, disabled, onStatus, onOpen, onClose }: {
  item: Item; x: number; y: number; disabled: boolean;
  onStatus: (status: Item['status']) => void; onOpen: () => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const rect = menu.current!.getBoundingClientRect();
    setPosition({left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))});
    menu.current!.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled), [role="menuitem"]')?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);
  return <div ref={menu} className="lm-item-menu" style={position} role="menu" aria-label={`Actions for ${item.title}`} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }}>
    <strong>{item.title}</strong>
    {STATUSES.map(status => <button key={status} type="button" role="menuitemradio" aria-checked={item.status === status} disabled={disabled} onClick={() => onStatus(status)}><i className={`lm-status-dot lm-status-${status.toLowerCase()}`} />{status}<span aria-hidden="true">{item.status === status ? '✓' : ''}</span></button>)}
    <button type="button" role="menuitem" className="lm-item-menu__open" onClick={onOpen}>Open details</button>
  </div>;
}
