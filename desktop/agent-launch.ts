import { sendT3Webhook } from '../src/t3-webhook.js';
import type { T3SendReply } from '../src/types.js';

export async function sendDesktopT3(prompt: unknown, webhookUrl: unknown): Promise<T3SendReply> {
  try {
    await sendT3Webhook(prompt, webhookUrl);
    return { accepted: true };
  } catch (error) {
    return { accepted: false, error: error instanceof Error ? error.message : 'Could not send the prompt to T3 Code.' };
  }
}
