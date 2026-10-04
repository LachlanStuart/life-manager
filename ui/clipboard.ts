/** Call from a user gesture, before starting any network request. */
export async function copyPrompt(prompt: string, field?: HTMLTextAreaElement): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(prompt);
    return;
  }
  const previous = document.activeElement as HTMLElement | null;
  const text = field ?? document.createElement('textarea');
  text.value = prompt;
  text.readOnly = true;
  if (!field) {
    text.style.position = 'fixed';
    text.style.opacity = '0';
    document.body.append(text);
  }
  try {
    text.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard access is unavailable.');
  } finally { if (!field) text.remove(); previous?.focus(); }
}
