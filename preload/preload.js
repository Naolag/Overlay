const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  getExclusionStatus: () => ipcRenderer.invoke('get-exclusion-status'),
  sendQuery: (prompt) => ipcRenderer.invoke('gemini-query', prompt),

  getWatermarkColor: () => ipcRenderer.invoke('get-watermark-color'),
  getLastExposureEvent: () => ipcRenderer.invoke('get-last-exposure-event'),
  resetSelfTest: () => ipcRenderer.invoke('reset-self-test'),

  // Fired when the self-test loop detects the watermark in a self-capture
  // (exclusion failed) — renderer must clear all sensitive content on this.
  onExposureDetected: (callback) => {
    ipcRenderer.on('exposure-detected', (event, data) => callback(data));
  },
  // Fired on manual panic-hide (Ctrl+Shift+Esc) — same clearing behavior,
  // but not a detected failure, so no warning banner needed for this one.
  onClearContent: (callback) => {
    ipcRenderer.on('clear-content', () => callback());
  },
});