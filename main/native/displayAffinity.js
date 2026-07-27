const koffi = require('koffi');

// ---------------------------------------------------------------------------
// SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) is the core privacy
// mechanism for the whole project — it tells Windows to render this window
// normally on the physical display, but omit it from any screen-capture API.
//
// Requires Windows 10 version 2004 (May 2020 Update) or later.
//
// This file is isolated on purpose: it's the one piece of Day 1 that's hardest
// to verify without a real Windows machine, and the most likely candidate to
// be swapped for a C# P/Invoke helper if the FFI pointer conversion proves
// unreliable. Keeping it in one small file means that swap touches nothing
// else in the app.
// ---------------------------------------------------------------------------

const WDA_NONE = 0x00000000;
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;

let SetWindowDisplayAffinity = null;

function loadNativeBinding() {
  try {
    const user32 = koffi.load('user32.dll');
    SetWindowDisplayAffinity = user32.func(
      'bool __stdcall SetWindowDisplayAffinity(void* hwnd, uint32 dwAffinity)'
    );
    return true;
  } catch (err) {
    console.error('[displayAffinity] Could not load user32.dll — are you on Windows?', err);
    return false;
  }
}

/**
 * Applies capture exclusion to an Electron BrowserWindow.
 * Returns true if the OS confirmed the flag was applied, false otherwise.
 * NEVER assume this succeeded without checking the return value.
 */
function excludeFromCapture(browserWindow) {
  if (!SetWindowDisplayAffinity) {
    const loaded = loadNativeBinding();
    if (!loaded) return false;
  }

  try {
    // getNativeWindowHandle() returns a Buffer *containing* the HWND value,
    // not a buffer that IS a pointer. On 64-bit Windows that value is an
    // 8-byte little-endian pointer — read it out and hand it to koffi.
    const hwndBuffer = browserWindow.getNativeWindowHandle();
    const hwndValue = hwndBuffer.readBigUInt64LE(0);
    const hwndPtr = koffi.address(hwndValue, 'void*'); // verify against your koffi version — see README

    const ok = SetWindowDisplayAffinity(hwndPtr, WDA_EXCLUDEFROMCAPTURE);
    if (!ok) {
      console.error('[displayAffinity] SetWindowDisplayAffinity returned false — NOT protected.');
    }
    return !!ok;
  } catch (err) {
    console.error('[displayAffinity] threw an error applying exclusion:', err);
    return false;
  }
}

module.exports = { excludeFromCapture, WDA_NONE, WDA_EXCLUDEFROMCAPTURE };
