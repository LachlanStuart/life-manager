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
    if (value === 'codex' || value === 't3' || value === 't3-launch') return value;
  } catch { /* Storage may be disabled. */ }
  return 'modal';
}

export function savePromptHandling(value: PromptHandling): void {
  try { clientStorage.setItem(key, value); } catch { /* Keep the choice for this session. */ }
}

export function readT3Location(): string {
  try { return clientStorage.getItem('life-manager.t3-location') ?? ''; } catch { return ''; }
}

export function saveT3Location(value: string): void {
  try { clientStorage.setItem('life-manager.t3-location', value); } catch { /* Keep the choice for this session. */ }
}
