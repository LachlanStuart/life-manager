import type { PromptHandling } from '../src/types';
import { clientStorage } from './client-storage';

const key = 'life-manager.prompt-handling';
const webhookUrlKey = 'life-manager.t3-webhook-url';

export function readT3WebhookUrl(): string {
  try { return clientStorage.getItem(webhookUrlKey) ?? ''; } catch { return ''; }
}

export function saveT3WebhookUrl(value: string): void {
  try { clientStorage.setItem(webhookUrlKey, value); } catch { /* Keep the choice for this session. */ }
}

export function readPromptHandling(): PromptHandling {
  try {
    const value = clientStorage.getItem(key);
    if (value === 'codex' || value === 't3') return value;
  } catch { /* Storage may be disabled. */ }
  return 'modal';
}

export function savePromptHandling(value: PromptHandling): void {
  try { clientStorage.setItem(key, value); } catch { /* Keep the choice for this session. */ }
}
