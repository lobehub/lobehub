import { contextBridge, ipcRenderer } from 'electron';

// Trusted app preload. Main handler validates sender and the current user's permissions.
contextBridge.exposeInMainWorld('app', { getVersion: () => ipcRenderer.invoke('app:getVersion') });
