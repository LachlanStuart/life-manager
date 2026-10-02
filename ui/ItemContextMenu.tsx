import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Item, WorkspaceSettings } from '../src/types';
import { DEFAULT_WORKSPACE_SETTINGS, propertyValue } from '../src/properties';
import { selectedProperty } from './PropertySelect';

export function ItemContextMenu({ item, x, y, disabled, settings, propertyId, onProperty, onStatus, onOpen, onClose }: {
  item: Item; x: number; y: number; disabled: boolean;
  settings?: WorkspaceSettings; propertyId?: string | null; onProperty?: (propertyId: string, value: string | null) => void;
  onStatus?: (status: Item['status']) => void; onOpen: () => void; onClose: () => void;
}) {
  const property = selectedProperty(settings ?? DEFAULT_WORKSPACE_SETTINGS, propertyId);
  const value = property ? propertyValue(item, property.id) : null;
  const options = property ? [{ id: null, label: property.unsetLabel, color: property.unsetColor }, ...property.options] : [];
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
    {options.map(option => <button key={option.id ?? ''} type="button" role="menuitemradio" aria-checked={value === option.id} disabled={disabled}
      onClick={() => { if (onProperty) onProperty(property!.id, option.id); else if (property?.id === 'status') onStatus?.(option.id); }}>
      <i className="lm-status-dot" style={{ backgroundColor: option.color }} />{option.label}<span aria-hidden="true">{value === option.id ? '✓' : ''}</span></button>)}
    <button type="button" role="menuitem" className="lm-item-menu__open" onClick={onOpen}>Open details</button>
  </div>;
}
