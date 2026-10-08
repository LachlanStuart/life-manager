import type { ReactNode } from 'react';
export type IconName = 'outline' | 'filter' | 'sort' | 'sunburst' | 'kanban' | 'Navigate' | 'Omni' | 'Importance' | 'Effort' | 'Create' | 'eye' | 'eye-off' | 'settings' | 'open-item' | 'move' | 'zoom';
const paths: Record<IconName, ReactNode> = {
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></>,
  outline: <><path d="M4 4v15h4M4 10h4M9 4h12M11 10h10M11 19h10" /></>,
  move: <><path d="M9 5H3v14h6m4-11 4 4-4 4m-6-4h14" /></>,
  zoom: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6m-3-3v6" /></>,
  sort: <><path d="M4 5v14m-3-3 3 3 3-3M10 5h11M10 10h8M10 15h5M10 20h2"/></>,
  sunburst: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5m9 4h-5M12 21v-5M3 12h5"/></>,
  kanban: <><rect x="3" y="4" width="5" height="15" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></>,
  Navigate: <><path d="M4 3v16l5-5 4 7 3-2-4-7h8Z"/></>,
  Omni: <><circle cx="12" cy="12" r="4"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3"/></>,
  Importance: <><path d="M4 12h16M7 8l-4 4 4 4m10-8 4 4-4 4"/></>,
  Effort: <><path d="M12 3v18m-4-4 4 4 4-4M8 7l4-4 4 4M4 18h3m10 0h3"/></>,
  Create: <><path d="M12 4v16M4 12h16"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></>,
  'eye-off': <><path d="m3 3 18 18M9.5 5.3A11 11 0 0 1 12 5c6 0 10 7 10 7a20 20 0 0 1-3 3.6M6 6.5A23 23 0 0 0 2 12s4 7 10 7c1.8 0 3.4-.6 4.8-1.4M10 10a3 3 0 0 0 4 4"/></>,
  settings: <path fill="currentColor" stroke="none" fillRule="evenodd" d="M19.65 9.66 L22.31 10.00 L22.31 14.00 L19.65 14.34 L19.06 15.76 L20.70 17.87 L17.87 20.70 L15.76 19.06 L14.34 19.65 L14.00 22.31 L10.00 22.31 L9.66 19.65 L8.24 19.06 L6.13 20.70 L3.30 17.87 L4.94 15.76 L4.35 14.34 L1.69 14.00 L1.69 10.00 L4.35 9.66 L4.94 8.24 L3.30 6.13 L6.13 3.30 L8.24 4.94 L9.66 4.35 L10.00 1.69 L14.00 1.69 L14.34 4.35 L15.76 4.94 L17.87 3.30 L20.70 6.13 L19.06 8.24 Z M15 12 A3 3 0 1 0 9 12 A3 3 0 1 0 15 12 Z" />,
  'open-item': <><path d="M14 4h6v6m0-6L10 14M10 5H4v15h15v-6"/></>,
};
export function Icon({ name }: { name: IconName }) {
  return <svg className="lm-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
