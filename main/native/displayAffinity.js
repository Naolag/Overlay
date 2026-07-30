const koffi = require('koffi');

// ---------------------------------------------------------------------------
// SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) is the core privacy
// mechanism for the whole project — it tells Windows to render this window
// normally on the physical display, but omit it from any screen-capture API.
//
// Requires Windows 10 version 2004 (May 2020 Update) or later, 64-bit.
//
// PARAMETER TYPE NOTE: the Win32 signature declares hwnd as `void*`, but we
// declare it here as `uint64` instead and pass the raw handle value directly.
// This is intentional, not a shortcut: on x64 Windows, the calling convention
// passes pointers and 64-bit integers identically (same register, same size,
// no reinterpretation needed), so this sidesteps needing a koffi API to
// "construct a pointer from a number" — a function name I was never fully
// certain of. This relies only on documented x64 ABI behavior instead.
// 32-bit Windows is out of scope (see README).
// ---------------------------------------------------------------------------

const WDA_NONE = 0x00000000;
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;

let SetWindowDisplayAffinity = null;
let GetWindowDisplayAffinity = null;

function loadNativeBinding() {
  let user32;
  try {
    user32 = koffi.load('user32.dll');
    SetWindowDisplayAffinity = user32.func(
      'bool __stdcall SetWindowDisplayAffinity(uint64 hwnd, uint32 dwAffinity)'
    );
  } catch (err) {
    console.error('[displayAffinity] FATAL: could not load SetWindowDisplayAffinity — are you on Windows?', err);
    return false; // this one is genuinely fatal — the core feature can't work without it
  }

  // GetWindowDisplayAffinity is diagnostic-only (used by checkAffinity() for
  // live verification during testing). Loaded separately and non-fatally —
  // a failure here must NEVER block the critical Set path above.
  try {
    GetWindowDisplayAffinity = user32.func(
      'bool __stdcall GetWindowDisplayAffinity(uint64 hwnd, uint32 *pdwAffinity)'
    );
  } catch (err) {
    console.warn(
      '[displayAffinity] GetWindowDisplayAffinity (diagnostic-only) failed to load — ' +
        'live verification logging will be unavailable, but core exclusion is unaffected:',
      err
    );
    GetWindowDisplayAffinity = null;
  }

  return true; // core binding succeeded regardless of diagnostic status
}

/**
 * Reads the raw HWND value out of Electron's handle buffer as a BigInt.
 * getNativeWindowHandle() returns a Buffer *containing* the handle value
 * (8 bytes, little-endian, on 64-bit Windows) — not a buffer that IS a
 * pointer. This just extracts that numeric value; no pointer construction.
 */
function getHwndValue(browserWindow) {
  const hwndBuffer = browserWindow.getNativeWindowHandle();
  return hwndBuffer.readBigUInt64LE(0);
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
    const hwndValue = getHwndValue(browserWindow);
    console.log('[displayAffinity] applying exclusion to hwnd:', hwndValue.toString(16));

    const ok = SetWindowDisplayAffinity(hwndValue, WDA_EXCLUDEFROMCAPTURE);
    if (!ok) {
      console.error(
        '[displayAffinity] SetWindowDisplayAffinity returned false — NOT protected. ' +
          'This means the call reached Windows but Windows rejected it — check your ' +
          'Windows version is 10 build 19041+ (run `winver`), and confirm this is a ' +
          '64-bit Windows install.'
      );
    }
    return !!ok;
  } catch (err) {
    console.error('[displayAffinity] threw an error applying exclusion (this means the call ' +
      'never reached Windows — a koffi/FFI-level problem, not a Windows rejection):', err);
    return false;
  }
}

/**
 * Independently asks Windows what the CURRENT display affinity of this
 * window is — as opposed to what we last told it to set. Use this to
 * confirm exclusion hasn't silently reset, and to rule out our own status
 * line lying to us.
 * Returns the raw affinity value (17 = WDA_EXCLUDEFROMCAPTURE, 1 =
 * WDA_MONITOR, 0 = WDA_NONE/no exclusion), or null if the check itself failed.
 */
function checkAffinity(browserWindow) {
  if (!GetWindowDisplayAffinity) return null;

  try {
    const hwndValue = getHwndValue(browserWindow);
    const out = [0]; // out-parameter buffer for koffi to write the affinity value into
    const ok = GetWindowDisplayAffinity(hwndValue, out);
    if (!ok) return null;
    return out[0];
  } catch (err) {
    console.error('[displayAffinity] checkAffinity failed:', err);
    return null;
  }
}

module.exports = { excludeFromCapture, checkAffinity, WDA_NONE, WDA_EXCLUDEFROMCAPTURE };