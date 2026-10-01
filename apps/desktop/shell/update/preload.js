const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateWindow', {
  onState: (callback) => {
    ipcRenderer.on('shell:update-state', (_event, state) => callback(state));
    ipcRenderer.invoke('shell:update-action', 'state').then(callback);
  },
  quit: () => ipcRenderer.invoke('shell:update-action', 'quit'),
  retry: () => ipcRenderer.invoke('shell:update-action', 'retry'),
});
