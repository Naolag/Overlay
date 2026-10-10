
const koffi = require('koffi');

if (process.platform !== 'win32') {
  throw new Error('Active-window tracking currently supports Windows only.');
}

const user32 = koffi.load('user32.dll');

const getForegroundWindow = user32.func(
  '__stdcall',
  'GetForegroundWindow',
  'void *',
  []
);

let lastExternalWindowHandle = null;
let trackingTimer = null;

function getForegroundWindowHandle() {
  const hwnd = getForegroundWindow();

  if (!hwnd) return null;

  return BigInt(koffi.address(hwnd)).toString(16);
}

function getBrowserWindowHandle(win) {
  if (!win || win.isDestroyed()) return null;

  const buffer = win.getNativeWindowHandle();

  if (!buffer || buffer.length < 8) return null;

  return buffer.readBigUInt64LE(0).toString(16);
}

function startForegroundWindowTracking(getOverlayWindow) {
  if (trackingTimer) return;

  trackingTimer = setInterval(() => {
    try {
      const currentHandle = getForegroundWindowHandle();
      const overlay = getOverlayWindow();
      const overlayHandle = getBrowserWindowHandle(overlay);

      if (
        currentHandle &&
        currentHandle !== overlayHandle
      ) {
        lastExternalWindowHandle = currentHandle;
        console.log('[active-window] Last external:', lastExternalWindowHandle);
      }
    } catch (error) {
      console.error('[active-window] Tracking error:', error.message);
    }
  }, 100);

  trackingTimer.unref();

  console.log('[active-window] Foreground tracking started.');
}

function getLastExternalWindowHandle() {
  return lastExternalWindowHandle;
}

module.exports = {
  getForegroundWindowHandle,
  getBrowserWindowHandle,
  startForegroundWindowTracking,
  getLastExternalWindowHandle,
};

