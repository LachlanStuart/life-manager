import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktop', {
  load: () => ipcRenderer.invoke('desktop:load'),
  chooseDirectory: () => ipcRenderer.invoke('desktop:directory'),
  connect: (config: unknown) => ipcRenderer.invoke('desktop:connect', config),
});
