require('dotenv').config();

const { app, BrowserWindow, dialog } = require('electron');
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

    // FAIL CLOSED: never show the window on a failed exclusion. A status
    // line you might not glance at is not a safety mechanism — refusing
    // to render at all is. This is deliberately loud and blocking.
    if (!exclusionApplied) {
      dialog.showErrorBox(
        'Capture exclusion failed',
        'SetWindowDisplayAffinity did not succeed. The overlay will stay hidden ' +
          'until this is fixed — do not attempt to use it on a real call.\n\n' +
          'Check the console log for details, and see README.md troubleshooting section.'
      );
      return; // window stays hidden
    }

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