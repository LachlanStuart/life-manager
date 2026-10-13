import type { T3SendReply } from '../src/types';
import { api } from './api';
import type { DesktopPreferences } from './client-storage';

declare global {
  interface Window {
    lifeManagerDesktop?: { sendT3: (prompt: string, webhookUrl: string) => Promise<T3SendReply>; preferences?: DesktopPreferences };
  }
}

export const isDesktopClient = () => Boolean(window.lifeManagerDesktop) || navigator.userAgent.includes('LifeManagerDesktop');

export async function sendT3(prompt: string, webhookUrl = ''): Promise<T3SendReply> {
  if (!webhookUrl.trim()) return { accepted: false, error: 'Set the T3 webhook URL in Settings → Prompts.' };
  try {
    if (window.lifeManagerDesktop?.sendT3) return await window.lifeManagerDesktop.sendT3(prompt, webhookUrl.trim());
    // An older or unavailable preload must not change which computer sends the request.
    if (isDesktopClient()) return { accepted: false, error: 'The desktop webhook connection is unavailable. Restart or update Life Manager and try again.' };
    return await api<T3SendReply>('agent/t3', { prompt, webhookUrl: webhookUrl.trim() });
  } catch (error) {
    return { accepted: false, error: error instanceof Error ? error.message : 'Could not send the prompt to T3 Code.' };
  }
}
