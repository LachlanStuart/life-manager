import type { PromptHandling } from '../src/types';

const key = 'life-manager.prompt-handling';
const locationKey = 'life-manager.t3-location';

export function readT3Location(): string {
  try { return localStorage.getItem(locationKey) ?? ''; } catch { return ''; }
}

export function saveT3Location(value: string): void {
  try { localStorage.setItem(locationKey, value); } catch { /* Keep the choice for this session. */ }
}

export function readPromptHandling(): PromptHandling {
  try {
    const value = localStorage.getItem(key);
    if (value === 'codex' || value === 't3') return value;
  } catch { /* Storage may be disabled. */ }
  return 'modal';
}

export function savePromptHandling(value: PromptHandling): void {
  try { localStorage.setItem(key, value); } catch { /* Keep the choice for this session. */ }
}
