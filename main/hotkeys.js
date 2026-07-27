const { globalShortcut } = require('electron');

/**
 * Registers the two global hotkeys the whole project depends on:
 *  - toggle: summon/dismiss the overlay
 *  - panicHide: force-hide immediately, no automation in between.
 *
 * panicHide is deliberately the dumbest, most direct code path in the app —
 * it should keep working even if other logic (self-test loop, etc.) breaks.
 */
function registerHotkeys({ getOverlayWindow }) {
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    const win = getOverlayWindow();
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });

  globalShortcut.register('CommandOrControl+Shift+Escape', () => {
    const win = getOverlayWindow();
    if (win && win.isVisible()) {
      win.hide();
      console.log('[panic-hide] overlay hidden manually');
    }
  });
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll();
}

module.exports = { registerHotkeys, unregisterHotkeys };
