const { ipcMain } = require('electron');
const geminiClient = require('../services/geminiClient');
const conversationState = require('./conversationState');
const { captureScreenshotPart } = require('./screenCapture');

/**
 * Central place to see every ipcMain.handle registration in the app.
 */
function registerIpcHandlers({ getExclusionApplied, getWatermarkColor, getLastExposureEvent, resetSelfTest }) {
  ipcMain.handle('get-exclusion-status', () => getExclusionApplied());

  // Typed chat — plain text query, uses shared conversation history
  ipcMain.handle('gemini-query', async (event, prompt) => {
    try {
      const history = conversationState.getHistory();
      const { text, history: updatedHistory } = await geminiClient.query({
        history,
        parts: [{ text: prompt }],
      });
      conversationState.setHistory(updatedHistory);
      return { ok: true, text };
    } catch (err) {
      console.error('[gemini-query] failed:', err);
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });

  // Screen recognition — captures the screen, sends it as an image alongside
  // an optional user prompt, uses the SAME shared history as typed chat
  ipcMain.handle('gemini-screen-query', async (event, userPrompt) => {
    try {
      const imagePart = await captureScreenshotPart();
      const promptText =
        userPrompt && userPrompt.trim()
          ? userPrompt
          : 'Read what is on this screen and help me understand/triage it. Be concise.';

      const history = conversationState.getHistory();
      const { text, history: updatedHistory } = await geminiClient.query({
        history,
        parts: [{ text: promptText }, imagePart],
      });
      conversationState.setHistory(updatedHistory);
      return { ok: true, text };
    } catch (err) {
      console.error('[gemini-screen-query] failed:', err);
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });

  // Voice input — renderer records audio and sends it here as base64
  ipcMain.handle('gemini-voice-query', async (event, { base64Audio, mimeType }) => {
    try {
      const audioPart = { inline_data: { mime_type: mimeType, data: base64Audio } };
      const history = conversationState.getHistory();
      const { text, history: updatedHistory } = await geminiClient.query({
        history,
        parts: [
          { text: 'Transcribe what I said, then answer it as a quick on-call triage question. Keep the answer concise.' },
          audioPart,
        ],
      });
      conversationState.setHistory(updatedHistory);
      return { ok: true, text };
    } catch (err) {
      console.error('[gemini-voice-query] failed:', err);
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });

  ipcMain.handle('clear-conversation', () => {
    conversationState.clear();
    return true;
  });

  ipcMain.handle('get-watermark-color', () => getWatermarkColor());
  ipcMain.handle('get-last-exposure-event', () => getLastExposureEvent());
  ipcMain.handle('reset-self-test', () => {
    resetSelfTest();
    return true;
  });
}

module.exports = { registerIpcHandlers };