import { useEffect, useRef, useState } from 'react';
import {
  getDefaultSunburstDisplay,
  useSunburstDisplay,
  writeSunburstDisplay,
  type SunburstDisplay,
} from './sunburst-display';

type NumberSettingKey = keyof Pick<SunburstDisplay,
  'fontSize' | 'minFontSize' | 'labelPadding' | 'outerLabelPadding' | 'minCharacters' | 'maxDepth'>;

const NUMBER_SETTINGS: ReadonlyArray<{ key: NumberSettingKey; label: string; step: number }> = [
  { key: 'fontSize', label: 'Font size (px)', step: 1 },
  { key: 'minFontSize', label: 'Minimum font size (px)', step: 1 },
  { key: 'labelPadding', label: 'Label padding (px)', step: 1 },
  { key: 'outerLabelPadding', label: 'Outer-edge label padding (px)', step: 1 },
  { key: 'minCharacters', label: 'Minimum visible characters', step: 1 },
  { key: 'maxDepth', label: 'Visible layers', step: 1 },
];

function normalizeNumber(key: NumberSettingKey, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  switch (key) {
    case 'fontSize':
    case 'minFontSize':
      return value > 0 ? value : null;
    case 'labelPadding':
    case 'outerLabelPadding':
      return value >= 0 ? value : null;
    case 'minCharacters':
      return value >= 1 ? Math.max(1, Math.round(value)) : null;
    case 'maxDepth':
      // maxDepth is constrained by the number of rings in the layout. The other
      // numeric settings deliberately have no arbitrary upper bound.
      return Math.min(7, Math.max(1, Math.round(value)));
  }
}

function normalizeRingWeight(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function displayNumber(value: number): string {
  return String(value);
}

interface DraftNumberInputProps {
  label: string;
  value: number;
  step: number;
  normalize: (value: number) => number | null;
  onCommit: (value: number) => void;
}

/**
 * A number input with a draft value. Keeping the draft separate from the
 * persisted display lets a phone user erase the old value before entering a
 * replacement. Invalid or empty drafts are restored on blur; Enter commits and
 * Escape cancels.
 */
function DraftNumberInput({ label, value, step, normalize, onCommit }: DraftNumberInputProps) {
  const [draft, setDraft] = useState(() => displayNumber(value));
  const focused = useRef(false);
  const skipNextBlur = useRef(false);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const normalizeRef = useRef(normalize);
  const onCommitRef = useRef(onCommit);
  draftRef.current = draft;
  valueRef.current = value;
  normalizeRef.current = normalize;
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (!focused.current) setDraft(displayNumber(value));
  }, [value]);

  // Navigating away from the settings modal is equivalent to leaving a field:
  // preserve a valid draft so an accidental modal close does not lose the edit.
  // Escape restores the draft first, so a cancelled edit is still discarded.
  useEffect(() => () => {
    const parsed = draftRef.current.trim() === '' ? Number.NaN : Number(draftRef.current);
    const normalized = normalizeRef.current(parsed);
    if (normalized !== null && normalized !== valueRef.current) onCommitRef.current(normalized);
  }, []);

  const restore = () => {
    focused.current = false;
    setDraft(displayNumber(value));
  };
  const commit = () => {
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
    const normalized = normalize(parsed);
    if (normalized === null) {
      restore();
      return;
    }
    focused.current = false;
    setDraft(displayNumber(normalized));
    onCommit(normalized);
  };

  return <label>
    <span>{label}</span>
    <input aria-label={label} type="number" inputMode="decimal" step={step} value={draft}
      onFocus={() => { focused.current = true; }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        if (skipNextBlur.current) {
          skipNextBlur.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          skipNextBlur.current = true;
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          restore();
          skipNextBlur.current = true;
          event.currentTarget.blur();
        }
      }} />
  </label>;
}

export function SunburstDisplaySettings() {
  const display = useSunburstDisplay();
  const update = (patch: Partial<SunburstDisplay>) => writeSunburstDisplay({ ...display, ...patch });
  const updateNumber = (key: NumberSettingKey, value: number) => update({ [key]: value } as Partial<SunburstDisplay>);
  return <div className="lm-settings-fields" aria-label="Sunburst display settings">
    <label><span>Radial titles</span><input type="checkbox" checked={display.radialLabels}
      onChange={event => update({ radialLabels: event.target.checked })} /></label>
    {NUMBER_SETTINGS.map(({ key, label, step }) => <DraftNumberInput key={key} label={label}
      value={display[key]} step={step} normalize={value => normalizeNumber(key, value)}
      onCommit={value => updateNumber(key, value)} />)}
    {display.ringWeights.slice(0, display.maxDepth).map((weight, index) => <DraftNumberInput
      key={index} label={`Layer ${index + 1} width`} value={weight} step={.1}
      normalize={normalizeRingWeight}
      onCommit={value => update({ ringWeights: display.ringWeights.map((entry, i) => i === index ? value : entry) })} />)}
    <button type="button" onClick={() => writeSunburstDisplay(getDefaultSunburstDisplay())}>Reset display</button>
  </div>;
}
