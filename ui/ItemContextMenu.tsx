import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Item, WorkspaceSettings } from '../src/types';
import { DEFAULT_WORKSPACE_SETTINGS, effectivePropertyValue, propertyValue, resolvePropertyValue } from '../src/properties';
import { propertyChoices, selectedProperty } from './PropertySelect';
import { Icon } from './Icons';

export function ItemContextMenu({ item, items = [], x, y, disabled, settings, propertyId, onProperty, onStatus, onOpen, onClose, onInclude, onMove, onZoom, onDelete, canZoom = true }: {
  item: Item; items?: readonly Item[]; x: number; y: number; disabled: boolean;
  settings?: WorkspaceSettings; propertyId?: string | null; onProperty?: (propertyId: string, value: string | null) => void;
  onStatus?: (status: Item['status']) => void; onOpen: () => void; onClose: () => void;
  onInclude?: () => void; onMove?: () => void; onZoom?: () => void; onDelete?: () => void; canZoom?: boolean;
}) {
  const property = selectedProperty(settings ?? DEFAULT_WORKSPACE_SETTINGS, propertyId);
  const value = property ? property.inheritFromParent ? propertyValue(item, property.id) : effectivePropertyValue(item, property, items) : null;
  const inherited = property?.inheritFromParent ? resolvePropertyValue({...item, ...(property.id === "status" ? {status: null} : {properties: {...item.properties, [property.id]: null}})}, property, items) : null;
  const inheritedOption = property?.options.find(option => option.id === inherited?.value);
  const options = property ? propertyChoices(property) : [];
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const rect = menu.current!.getBoundingClientRect();
    setPosition({left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))});
    menu.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
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
    <strong title={item.title}>{item.title}</strong>
    <button type="button" role="menuitem" onClick={onOpen}><Icon name="open-item" />Open details</button>
    {onInclude && <button type="button" role="menuitemcheckbox" aria-checked={item.included} disabled={disabled} onClick={onInclude}>
      <Icon name={item.included ? 'eye' : 'eye-off'} />Included on dashboard<span aria-hidden="true">{item.included ? '✓' : ''}</span>
    </button>}
    {onMove && <button type="button" role="menuitem" disabled={disabled} onClick={onMove}><Icon name="move" />Move…</button>}
    {onZoom && <button type="button" role="menuitem" disabled={!canZoom} onClick={onZoom}><Icon name="zoom" />Zoom in</button>}
    {onDelete && <button type="button" role="menuitem" className="lm-danger" disabled={disabled} onClick={onDelete}><Icon name="trash" />Delete</button>}
    {options.length > 0 && <div role="separator" className="lm-item-menu__separator" />}
    {options.map(option => <button key={option.id ?? ''} type="button" role="menuitemradio" aria-checked={value === option.id} disabled={disabled} title={option.id === null && inherited ? inherited.source ? `Inherited from ${inherited.source.title}` : "Workspace default" : undefined}
      onClick={() => { if (onProperty) onProperty(property!.id, option.id); else if (property?.id === 'status') onStatus?.(option.id); }}>
      <i className="lm-status-dot" style={{ backgroundColor: option.color }} />{option.id === null && inheritedOption ? `Inherit · ${inheritedOption.label}` : option.label}<span aria-hidden="true">{value === option.id ? '✓' : ''}</span></button>)}
  </div>;
}
