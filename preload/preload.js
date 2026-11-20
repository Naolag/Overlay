const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  getExclusionStatus: () => ipcRenderer.invoke('get-exclusion-status'),
  sendQuery: (prompt) => ipcRenderer.invoke('gemini-query', prompt),
  sendScreenQuery: (prompt) => ipcRenderer.invoke('gemini-screen-query', prompt),
  sendVoiceQuery: (base64Audio, mimeType) =>
    ipcRenderer.invoke('gemini-voice-query', { base64Audio, mimeType }),
  clearConversation: () => ipcRenderer.invoke('clear-conversation'),

  getDesktopSourceId: () => ipcRenderer.invoke('get-desktop-source-id'),
  saveScreenRecording: (arrayBuffer, mimeType) =>
  ipcRenderer.invoke('save-screen-recording', {
    arrayBuffer,
    mimeType,
  }),
  summarizeRecording: (base64Audio, mimeType, label) =>
    ipcRenderer.invoke('gemini-summarize-recording', { base64Audio, mimeType, label }),
  getAllLessons: () => ipcRenderer.invoke('get-all-lessons'),
  getJobSessionStatus: () => ipcRenderer.invoke('get-job-session-status'),
  startJobSession: (session) => ipcRenderer.invoke('start-job-session', session),
  retryJobContext: () => ipcRenderer.invoke('retry-job-context'),
  endJobSession: () => ipcRenderer.invoke('end-job-session'),
  retrySessionSave: () => ipcRenderer.invoke('retry-job-session-save'),
  captureLiveCodingWindow: () => ipcRenderer.invoke('live-coding-capture'),
  captureLiveCodingScreenshot: (targetScreenshotId) => ipcRenderer.invoke('live-coding-capture-screenshot', targetScreenshotId),
  reconstructLiveCodingScreenshots: (screenshots) => ipcRenderer.invoke('live-coding-reconstruct-screenshots', screenshots),
  generateLiveCodingPatch: (payload) => ipcRenderer.invoke('live-coding-generate-patch', payload),
  endLiveCodingSession: () => ipcRenderer.invoke('live-coding-end-session'),
  setLiveCodingWindowMode: (mode) => ipcRenderer.invoke('live-coding-window-mode', mode),
  copyLiveCodingCode: (code) => ipcRenderer.invoke('live-coding-copy-result', code),
  hideLiveCodingOverlay: () => ipcRenderer.invoke('live-coding-hide-overlay'),

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
  // Fired when the global hotkeys for screen-read / voice-toggle are
  // pressed — renderer runs the same code path a button click would.
  onTriggerReadScreen: (callback) => {
    ipcRenderer.on('trigger-read-screen', () => callback());
  },
  onTriggerLiveCoding: (callback) => {
    ipcRenderer.on('trigger-live-coding', () => callback());
  },
  onTriggerLiveCodingAnalyze: (callback) => {
    ipcRenderer.on('trigger-live-coding-analyze', () => callback());
  },
  onTriggerLiveCodingEnd: (callback) => {
    ipcRenderer.on('trigger-live-coding-end', () => callback());
  },
  onTriggerToggleVoice: (callback) => {
    ipcRenderer.on('trigger-toggle-voice', () => callback());
  },
  onToggleScreenRecording: (callback) => {
  ipcRenderer.on('trigger-toggle-screen-recording', () => callback());
},
  onJobSessionError: (callback) => {
    ipcRenderer.on('job-session-error', (_event, data) => callback(data));
  },


});
