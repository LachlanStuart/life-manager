import { clipboard } from 'electron';
import { mkdir } from 'node:fs/promises';
import { launchT3Conversation } from '../src/t3-launch.js';
import type { T3LaunchReply } from '../src/types.js';
import type { DesktopConfig } from './config.js';

export async function launchDesktopT3(prompt: unknown, config: DesktopConfig | undefined, defaultDirectory: string): Promise<T3LaunchReply> {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200_000 || prompt.includes('\0')) throw new Error('Invalid agent prompt.');
  let copied = false;
  try {
    clipboard.writeText(prompt); copied = true;
    const directory = config?.mode === 'local' ? config.dataDir : defaultDirectory;
    await mkdir(directory, { recursive: true });
    await launchT3Conversation(directory);
    return { copied, opened: true, location: 'device' };
  } catch (error) {
    return { copied, opened: false, location: 'device', error: error instanceof Error ? error.message : String(error) };
  }
}
