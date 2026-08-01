const { ipcMain, desktopCapturer } = require('electron');
const geminiClient = require('../services/geminiClient');
const conversationState = require('./conversationState');
const { captureScreenshotPart } = require('./screenCapture');
const lessonsStore = require('./lessonsStore');

// Applied to every Gemini call via system_instruction — the correct place
// for persistent context/persona, rather than repeating disambiguating text
// in each individual prompt. Fixes "on-call"/"triage" defaulting toward a
// medical interpretation when spoken without surrounding software context.
const SYSTEM_INSTRUCTION =
  'You are a technical assistant helping a software engineer solve programming ' +
  'problems, debug production incidents, and answer related engineering questions. ' +
  'This is a software engineering / DevOps / SRE context — production systems, ' +
  'servers, deployments, code, logs, error messages. It is NEVER medical, even if ' +
  'words like "on-call" or "triage" appear alone — always interpret those as ' +
  'software incident-response terms. Keep answers concise and practical.';

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
        systemInstruction: SYSTEM_INSTRUCTION,
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
          : 'Read what is on this screen and help me understand or triage it.';

      const history = conversationState.getHistory();
      const { text, history: updatedHistory } = await geminiClient.query({
        history,
        parts: [{ text: promptText }, imagePart],
        systemInstruction: SYSTEM_INSTRUCTION,
      });
      conversationState.setHistory(updatedHistory);
      return { ok: true, text };
    } catch (err) {
      console.error('[gemini-screen-query] failed:', err);
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });

  // Voice input (microphone) — quick spoken Q&A, shares the same history
  ipcMain.handle('gemini-voice-query', async (event, { base64Audio, mimeType }) => {
    try {
      const audioPart = { inline_data: { mime_type: mimeType, data: base64Audio } };
      const history = conversationState.getHistory();
      const { text, history: updatedHistory } = await geminiClient.query({
        history,
        parts: [{ text: 'Transcribe what I said, then answer it.' }, audioPart],
        systemInstruction: SYSTEM_INSTRUCTION,
      });
      conversationState.setHistory(updatedHistory);
      return { ok: true, text };
    } catch (err) {
      console.error('[gemini-voice-query] failed:', err);
      return { ok: false, error: err.message || 'Unknown error' };
    }
  });

  // Desktop audio source id — needed by the renderer to request loopback
  // system audio via getUserMedia's legacy chromeMediaSource constraints.
  // desktopCapturer isn't directly available in the renderer (contextIsolation),
  // so this is the bridge.
  ipcMain.handle('get-desktop-source-id', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return sources.length ? sources[0].id : null;
    } catch (err) {
      console.error('[get-desktop-source-id] failed:', err);
      return null;
    }
  });

  // Recording summarizer — for postmortems/conference talks played through
  // your speakers (public/team-owned recordings, NOT live call audio).
  // Runs a SEPARATE, non-conversational query (own system instruction, no
  // shared history) since this is a structured-extraction task, not chat —
  // mixing it into the running conversation would pollute both.
ipcMain.handle('gemini-summarize-recording', async (event, { base64Audio, mimeType, label }) => {
  try {
    const audioPart = { inline_data: { mime_type: mimeType, data: base64Audio } };
    const extractionInstruction =
      'Your task is to produce a concise, structured response tailored for programming interview preparation. ' +
      'Analyze the input nature and organize the output into the following sections:\n' +
      '1. Problem Context\n2. Root Cause / Key Insight\n3. Solution / Resolution\n' +
      '4. Lessons for Interviews\n5. Broader Engineering Principles\n' +
      'Guidelines: Be concise, use bullet points, write "None mentioned" if not applicable. ' +
      'Focus on programming and engineering — never medical topics.';

    // ✅ Use shared conversation history instead of []
    const history = conversationState.getHistory();
    const { text, history: updatedHistory } = await geminiClient.query({
      history,
      parts: [audioPart],
      systemInstruction: extractionInstruction,
    });

    // ✅ Update conversation state so follow-ups work
    conversationState.setHistory(updatedHistory);

    const record = lessonsStore.saveLesson({ label, summary: text });
    return { ok: true, text, savedAs: record.id };
  } catch (err) {
    console.error('[gemini-summarize-recording] failed:', err);
    return { ok: false, error: err.message || 'Unknown error' };
  }
});


  ipcMain.handle('get-all-lessons', () => {
    try {
      return { ok: true, lessons: lessonsStore.getAllLessons() };
    } catch (err) {
      console.error('[get-all-lessons] failed:', err);
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