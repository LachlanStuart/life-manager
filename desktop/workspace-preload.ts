import { contextBridge, ipcRenderer } from 'electron';

if (process.isMainFrame) contextBridge.exposeInMainWorld('lifeManagerDesktop', {
  sendT3: (prompt: string, webhookUrl: string) => ipcRenderer.invoke('workspace:send-t3', prompt, webhookUrl),
});
