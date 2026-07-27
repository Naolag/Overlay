const { ipcMain } = require('electron');
const geminiClient = require('../services/geminiClient');

/**
 * Central place to see every ipcMain.handle registration in the app.
 * As services/ grows (audit log, notes store), their IPC surface gets
 * wired up here rather than scattered across files.
 */
function registerIpcHandlers({ getExclusionApplied }) {
  ipcMain.handle('get-exclusion-status', () => getExclusionApplied());

  ipcMain.handle('gemini-query', async (event, prompt) => {
    try {
      const text = await geminiClient.query(prompt);
      return { ok: true, text };
    } catch (err) {
      console.error('[gemini-query] failed:', err);
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });
}

module.exports = { registerIpcHandlers };
