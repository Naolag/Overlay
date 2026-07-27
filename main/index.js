require('dotenv').config();

const { app, BrowserWindow } = require('electron');
const path = require('path');

const { excludeFromCapture } = require('./native/displayAffinity');
const { registerHotkeys, unregisterHotkeys } = require('./hotkeys');
const { registerIpcHandlers } = require('./ipcHandlers');

let overlayWindow = null;
let exclusionApplied = false;

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 560,
    x: 60,
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' level keeps it above fullscreen apps/conferencing clients
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  overlayWindow.once('ready-to-show', () => {
    exclusionApplied = excludeFromCapture(overlayWindow);
    console.log('[capture-exclusion] applied:', exclusionApplied);
    overlayWindow.show();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

app.whenReady().then(() => {
  createOverlayWindow();

  registerHotkeys({ getOverlayWindow: () => overlayWindow });
  registerIpcHandlers({ getExclusionApplied: () => exclusionApplied });
});

app.on('will-quit', () => {
  unregisterHotkeys();
});

app.on('window-all-closed', () => {
  app.quit();
});
