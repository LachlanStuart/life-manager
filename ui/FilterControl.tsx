import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceSettings } from '../src/types';
import type { PropertyFilters } from './property-filters';
import { Icon } from './Icons';
import './filters.css';

export function FilterControl({ settings, filters, onChange }: {
  settings: WorkspaceSettings; filters: PropertyFilters; onChange: (filters: PropertyFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({left: 8, top: 8});
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const hiddenCount = Object.values(filters).reduce((count, values) => count + values.length, 0);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect(), rect = popup.current!.getBoundingClientRect();
      setPosition({left: Math.max(8, Math.min(anchor.left, innerWidth - rect.width - 8)), top: Math.max(8, Math.min(anchor.bottom + 6, innerHeight - rect.height - 8))});
    };
    place(); popup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const setExcluded = (id: string, values: (string | null)[]) => {
    const next = {...filters};
    if (values.length) next[id] = values; else delete next[id];
    onChange(next);
  };
  return <>
    <button ref={trigger} className="lm-filter-button" aria-label={hiddenCount ? `Filters (${hiddenCount} hidden values)` : 'Filters'}
      aria-haspopup="dialog" aria-expanded={open} data-active={hiddenCount > 0} onClick={() => setOpen(value => !value)}>
      <Icon name="filter" /><span>Filter</span>{hiddenCount > 0 && <b>{hiddenCount}</b>}
    </button>
    {open && createPortal(<div ref={popup} role="dialog" aria-label="Filter Items" className="lm-filters" style={position}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <header><strong>Filter Items</strong><button onClick={() => onChange({})} disabled={!hiddenCount}>Reset all</button><button aria-label="Close filters" onClick={close}>×</button></header>
      <p>Show checked values. Changes apply immediately.</p>
      {settings.properties.map(property => {
        const values = [{id: null, label: property.unsetLabel, color: property.unsetColor}, ...property.options];
        const excluded = filters[property.id] ?? [];
        return <fieldset key={property.id}><legend>{property.name}</legend>
          <div className="lm-filters__shortcuts"><button aria-label={`Show all ${property.name} values`} onClick={() => setExcluded(property.id, [])}>All</button>
            <button aria-label={`Hide all ${property.name} values`} onClick={() => setExcluded(property.id, values.map(value => value.id))}>None</button></div>
          <div className="lm-filters__values">{values.map(value => <button key={value.id ?? ''} aria-pressed={!excluded.includes(value.id)}
            title={value.id === property.defaultValue ? `${value.label} (default for new Items)` : value.label}
            onClick={() => setExcluded(property.id, excluded.includes(value.id) ? excluded.filter(id => id !== value.id) : [...excluded, value.id])}>
            <span className="lm-filters__check" aria-hidden="true">{excluded.includes(value.id) ? '' : '✓'}</span><i style={{background: value.color}} />{value.label}
            {value.id === property.defaultValue && <small aria-hidden="true">default</small>}
          </button>)}</div>
        </fieldset>;
      })}
    </div>, document.body)}
  </>;
}
