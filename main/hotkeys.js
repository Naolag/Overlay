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
      // Send the clear signal before hiding: the window stays alive in the
      // background (hide() doesn't destroy it), so this reaches the renderer
      // fine and means no stale content is sitting there if it's reopened.
      // Deliberately still the dumbest, most direct path in the app — no
      // dependency on the self-test loop or anything else that could break.
      win.webContents.send('clear-content');
      win.hide();
      console.log('[panic-hide] overlay hidden manually, content cleared');
    }
  });
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll();
}

module.exports = { registerHotkeys, unregisterHotkeys };