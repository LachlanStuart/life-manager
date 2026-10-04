import type { T3LaunchReply } from '../src/types';
import { api } from './api';
import { copyPrompt } from './clipboard';

declare global {
  interface Window {
    lifeManagerDesktop?: { launchT3: (prompt: string) => Promise<T3LaunchReply> };
  }
}

export const isDesktopClient = () => Boolean(window.lifeManagerDesktop) || navigator.userAgent.includes('LifeManagerDesktop');

export async function launchT3(prompt: string): Promise<T3LaunchReply> {
  // Desktop must never fall back to launching on a connected server.
  if (window.lifeManagerDesktop) return window.lifeManagerDesktop.launchT3(prompt);
  if (isDesktopClient()) return { copied: false, opened: false, location: 'device', error: 'The desktop launch connection is unavailable. Restart or update Life Manager and try again.' };
  try { await copyPrompt(prompt); }
  catch { return { copied: false, opened: false, location: 'server', error: 'Could not copy the prompt. T3 Code was not opened. Use Show prompt to copy it manually.' }; }
  try {
    await api('agent/t3', {});
    return { copied: true, opened: true, location: 'server' };
  } catch (error) {
    return { copied: true, opened: false, location: 'server', error: error instanceof Error ? error.message : 'Could not open T3 Code.' };
  }
}
