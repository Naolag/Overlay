const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  getExclusionStatus: () => ipcRenderer.invoke('get-exclusion-status'),
  sendQuery: (prompt) => ipcRenderer.invoke('gemini-query', prompt),
});
