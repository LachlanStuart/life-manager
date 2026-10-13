import { contextBridge, ipcRenderer } from 'electron';

if (process.isMainFrame) contextBridge.exposeInMainWorld('lifeManagerDesktop', {
  launchT3: (prompt: string, location?: string) => ipcRenderer.invoke('workspace:launch-t3', prompt, location),
  sendT3: (prompt: string, webhookUrl: string) => ipcRenderer.invoke('workspace:send-t3', prompt, webhookUrl),
});
