require('dotenv').config();

const {
  app,
  BrowserWindow,
  dialog,
  session,
  desktopCapturer,
} = require('electron');
const path = require('path');

const { excludeFromCapture, checkAffinity } = require('./native/displayAffinity');
const { registerHotkeys, unregisterHotkeys } = require('./hotkeys');
const { registerIpcHandlers } = require('./ipcHandlers');
const { CaptureSelfTest } = require('./captureSelfTest');

let overlayWindow = null;
let exclusionApplied = false;
let selfTest = null;
let lastExposureEvent = null;

function handleExposureDetected({ timestamp }) {
  lastExposureEvent = { timestamp };
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('exposure-detected', { timestamp });
    overlayWindow.hide();
  }
}

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
      enableBlinkFeatures: 'MediaCapture',
      
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

    // DIAGNOSTIC: log Windows' own reported affinity value every 5s so you
    // can watch the console live while testing against Zoom/Teams/etc and
    // see if it silently reverts. 17 = WDA_EXCLUDEFROMCAPTURE (expected),
    // 1 = WDA_MONITOR (fallback, older/weaker), 0 = WDA_NONE (not excluded).
    setInterval(() => {
      const affinity = checkAffinity(overlayWindow);
      console.log('[diagnostic] current OS-reported affinity:', affinity);
    }, 5000);

    // Day 5: continuous self-test — independently verifies via a watermark
    // capture check, not just trusting the affinity flag stayed set.
    selfTest = new CaptureSelfTest({
      getOverlayWindow: () => overlayWindow,
      onExposureDetected: handleExposureDetected,
    });
    selfTest.start();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

app.whenReady().then(() => {
  // Required for navigator.mediaDevices.getUserMedia (voice input) to work
  // at all — Electron blocks media permission requests by default.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });
  // Allow renderer calls to navigator.mediaDevices.getDisplayMedia()
// to capture the entire Windows desktop.
session.defaultSession.setDisplayMediaRequestHandler(
  async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });

      if (!sources.length) {
        console.error('[screen-recording] No screen sources found');
        callback({});
        return;
      }

      // For now, automatically select the first physical display.
      const screen = sources[0];

      console.log(
        '[screen-recording] Granting capture source:',
        screen.name,
        screen.id
      );

      callback({
        video: screen,
      });
    } catch (err) {
      console.error(
        '[screen-recording] Failed to get desktop source:',
        err
      );

      callback({});
    }
  }
);

  createOverlayWindow();

  registerHotkeys({
    getOverlayWindow: () => overlayWindow,
    onReadScreen: () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayWindow.show();
      overlayWindow.webContents.send('trigger-read-screen');
    },
    onToggleVoice: () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayWindow.show();
      overlayWindow.webContents.send('trigger-toggle-voice');
    },
    onToggleScreenRecording: () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.show();
    overlayWindow.webContents.send('trigger-toggle-screen-recording');
  },
  });

  registerIpcHandlers({
    getExclusionApplied: () => exclusionApplied,
    getWatermarkColor: () => (selfTest ? selfTest.getWatermarkColor() : null),
    getLastExposureEvent: () => lastExposureEvent,
    resetSelfTest: () => {
      if (selfTest) selfTest.reset();
    },
  });
});

app.on('will-quit', () => {
  unregisterHotkeys();
  if (selfTest) selfTest.stop();
});

app.on('window-all-closed', () => {
  app.quit();
});