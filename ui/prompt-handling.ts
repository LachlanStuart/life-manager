import type { PromptHandling } from '../src/types';

const key = 'life-manager.prompt-handling';

export function readPromptHandling(): PromptHandling {
  try {
    const value = localStorage.getItem(key);
    if (value === 'codex') return value;
  } catch { /* Storage may be disabled. */ }
  return 'modal';
}

export function savePromptHandling(value: PromptHandling): void {
  try { localStorage.setItem(key, value); } catch { /* Keep the choice for this session. */ }
}
