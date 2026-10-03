import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '../src/types';
export function PeriodControl({ workspace, snapshotId, busy, onSelect, onPlan, onNext, onReset }: {
  workspace: Workspace | null; snapshotId?: string; busy: boolean; onSelect: (id?: string) => void; onPlan: () => void; onNext: () => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const snapshot = workspace?.snapshots.find(value => value.id === snapshotId);
  const period = workspace?.periods.find(value => value.id === workspace.dashboard.periodId);
  const planned = workspace?.snapshots.some(value => value.periodId === period?.id && value.kind === 'planned');
  const phase = snapshot ? snapshot.kind : planned ? 'Active' : 'Planning';
  const choose = (id?: string) => { setOpen(false); onSelect(id); };
  return <div className="lm-period-picker" ref={root}>
    <button ref={button} type="button" aria-label="Dashboard period" aria-expanded={open} aria-haspopup="dialog" disabled={!workspace || busy} onClick={() => setOpen(value => !value)}>
      {period?.name ?? 'Period'} <span>({phase})</span> <span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="lm-period-panel" role="dialog" aria-label="Choose a period">
      <div className="lm-period-flow" aria-label="Period phases">
        <button type="button" disabled aria-current={!snapshotId && !planned ? 'step' : undefined}>Planning</button><span aria-hidden="true">»</span>
        <button type="button" aria-label="Planning is finished" title="Finish planning" aria-current={!snapshotId && planned ? 'step' : undefined} disabled={!workspace || busy || planned || !!snapshotId} onClick={onPlan}>Active</button><span aria-hidden="true">»</span>
        <button type="button" aria-label="Roll over" title="Start the next period" disabled={!workspace || busy || !!snapshotId} onClick={() => { setOpen(false); onNext(); }}>Next</button>
      </div>
      <button type="button" disabled={!workspace || busy || !!snapshotId} onClick={() => { setOpen(false); button.current?.focus(); onReset(); }}>Reset properties…</button>
      <button type="button" aria-current={!snapshotId ? 'true' : undefined} onClick={() => choose()}>Current period</button>
      {workspace?.periods.map(period => <section key={period.id} aria-label={period.name}><strong>{period.name}</strong>
        {workspace.snapshots.filter(value => value.periodId === period.id).map(snapshot => <button type="button" key={snapshot.id} aria-current={snapshotId === snapshot.id ? 'true' : undefined} onClick={() => choose(snapshot.id)}>
          {snapshot.kind[0]!.toUpperCase() + snapshot.kind.slice(1)} <span>{new Date(snapshot.capturedAt).toLocaleDateString()}</span>
        </button>)}
      </section>)}
    </div>}
  </div>;
}
