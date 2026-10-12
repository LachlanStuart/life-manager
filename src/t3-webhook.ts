import { z } from 'zod';

export const t3WebhookInputSchema = z.object({
  prompt: z.string().min(1).max(200_000).refine(value => Boolean(value.trim()) && !value.includes('\0'), 'Invalid agent prompt.'),
  webhookUrl: z.string().trim().min(1, 'Set the T3 webhook URL in Settings → Prompts.').max(8192).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && !/\s/.test(value);
    } catch { return false; }
  }, 'Enter a complete HTTP or HTTPS T3 webhook URL without credentials or a fragment.'),
}).strict();

/** A webhook invocation starts work; never retry an uncertain delivery automatically. */
export async function sendT3Webhook(prompt: unknown, webhookUrl: unknown): Promise<void> {
  const parsed = t3WebhookInputSchema.safeParse({ prompt, webhookUrl });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid T3 webhook settings.');
  let response: Response;
  try {
    response = await fetch(parsed.data.webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: parsed.data.prompt }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // URLs carry webhook secrets; neither transport errors nor response bodies are safe to display.
    throw new Error('Could not confirm delivery to T3 Code. Check the webhook URL and connection, and check T3 Code before trying again to avoid starting the task twice.');
  }
  await response.body?.cancel();
  if (!response.ok) throw new Error(`T3 Code did not accept the webhook (HTTP ${response.status}). Check the webhook URL and task configuration in T3 Code before trying again.`);
}
