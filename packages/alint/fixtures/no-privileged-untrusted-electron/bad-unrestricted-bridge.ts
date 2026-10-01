import { contextBridge, ipcRenderer } from 'electron';

// Preload attached to remote preview frames.
// alint-expect
contextBridge.exposeInMainWorld('host', {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke(channel, payload),
});
