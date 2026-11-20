const { ipcMain, desktopCapturer, app, clipboard, BrowserWindow } = require('electron');
const geminiClient = require('../services/geminiClient');
const conversationState = require('./conversationState');
const { captureWindowSourcePart, captureLiveCodingScreenshotPart } = require('./screenCapture');
const { getLastExternalWindowHandle, } = require('./activeWindow');
const lessonsStore = require('./lessonsStore');
const interviewSession = require('../services/interviewSession');
const interviewPrompts = require('../services/interviewPrompts');
const { readWindowAccessibility, buildPanelText } = require('../services/windowsAccessibilityReader');
const {
  LIVE_CODING_SYSTEM_PROMPT,
  SCREENSHOT_RECONSTRUCTION_PROMPT,
  parsePatchResponse,
  parseScreenshotReconstruction,
  applyPatch,
} = require('../services/liveCodingPatch');
const cv_prompt=require('../cv');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let liveCodingTempDirectory = null;
const liveCodingScreenshotSlots = new Map();
const liveCodingWindowBounds = new Map();

async function saveLiveCodingScreenshot(screenshot, targetScreenshotId) {
  if (!liveCodingTempDirectory) {
    liveCodingTempDirectory = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'overlay-live-coding-'));
  }

  let screenshotId = targetScreenshotId || '';
  if (screenshotId && !liveCodingScreenshotSlots.has(screenshotId)) {
    throw new Error('That screenshot ID is no longer available. Choose an active screenshot ID or capture a new view.');
  }
  if (!screenshotId) {
    if (liveCodingScreenshotSlots.size >= 20) throw new Error('The screenshot limit is 20. Replace a screenshot or end this session.');
    screenshotId = `S${String(liveCodingScreenshotSlots.size + 1).padStart(2, '0')}`;
  }

  const previous = liveCodingScreenshotSlots.get(screenshotId);
  const revision = (previous?.revision || 0) + 1;
  const fileName = `${screenshotId}-r${String(revision).padStart(2, '0')}.jpg`;
  const filePath = path.join(liveCodingTempDirectory, fileName);
  const imageBytes = Buffer.from(screenshot.imagePart.inline_data.data, 'base64');
  await fs.promises.writeFile(filePath, imageBytes, { flag: 'wx' });
  liveCodingScreenshotSlots.set(screenshotId, {
    revision,
    filePaths: [...(previous?.filePaths || []), filePath],
  });

  return {
    ...screenshot,
    screenshotId,
    revision,
  };
}

async function endLiveCodingScreenshotSession() {
  const directory = liveCodingTempDirectory;
  if (directory) await fs.promises.rm(directory, { recursive: true, force: true });
  liveCodingTempDirectory = null;
  liveCodingScreenshotSlots.clear();
  return { ok: true };
}

async function queryLiveCodingWithOptionalPythonExecution(request) {
  try {
    return await geminiClient.query({ ...request, tools: [{ code_execution: {} }] });
  } catch (error) {
    const details = `${error.message || ''} ${error.cause || ''}`;
    if (!/code[_ ]execution|tool.{0,30}not supported|unsupported.{0,30}tool/i.test(details)) throw error;
    console.warn('[live-coding] Gemini code execution is unavailable for the selected model; retrying without it.');
    const fallback = await geminiClient.query(request);
    return { ...fallback, codeExecutionResults: [], codeExecutionUnavailable: true };
  }
}
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

async function buildSessionContext(details) {
  const budgetText = [
    `${interviewPrompts.PRIMARY_SCREEN_PROMPT}\n\nJob context:\n`,
    details.options?.transcribeQuestion
      ? interviewPrompts.QUESTION_TRANSCRIPTION_INSTRUCTION
      : '',
  ].filter(Boolean).join('\n');
  const promptAndSystemTokens = await geminiClient.countTokens({
    parts: [{ text: budgetText }],
    systemInstruction: SYSTEM_INSTRUCTION,
  });
  const tokenLimit = interviewPrompts.getJobContextTokenLimit(promptAndSystemTokens);
  const compacted = await interviewPrompts.compactJobContext({
    geminiClient,
    jobName: details.jobName,
    jobDescription: details.jobDescription,
    requiredSkills: details.requiredSkills,
    tokenLimit,
  });
  await interviewSession.setContext({
    text: compacted.text,
    tokenLimit,
    tokenCount: compacted.tokenCount,
  });
  return { tokenLimit, tokenCount: compacted.tokenCount };
}

function parseQuestionAndAnswer(text) {
  const question = text.match(/^\s*\*{0,2}QUESTION\*{0,2}:\s*([\s\S]*?)\s*\n\s*\*{0,2}ANSWER\*{0,2}:/im)?.[1]?.trim() || null;
  const answer = text.match(/(?:^|\n)\s*\*{0,2}ANSWER\*{0,2}:\s*([\s\S]*?)\s*$/i)?.[1]?.trim();
  if (answer !== undefined) return { question, answer };
  if (/\*{0,2}QUESTION\*{0,2}:/i.test(text)) {
    return { question: null, answer: '', unparsed: true };
  }
  return { question: null, answer: String(text || '').trim() };
}

/**
 * Central place to see every ipcMain.handle registration in the app.
 */
function registerIpcHandlers({ getExclusionApplied, getWatermarkColor, getLastExposureEvent, resetSelfTest }) {
  ipcMain.handle('get-exclusion-status', () => getExclusionApplied());
  ipcMain.handle('live-coding-copy-result', (_event, code) => {
    if (typeof code !== 'string') throw new Error('No assembled code is available to copy.');
    clipboard.writeText(code);
    return { ok: true };
  });
  ipcMain.handle('live-coding-hide-overlay', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.hide();
    return { ok: true };
  });

  // Separate, read-only live-coding capture path. It does not share history,
  // prompts, or state with the existing chat and screenshot-answer flows.
  ipcMain.handle('live-coding-capture', async () => {
    try {
      const hwnd = getLastExternalWindowHandle();
      if (!hwnd) throw new Error('No target window found. Focus the interview window and press Ctrl+I again.');
      const targetHandle = BigInt(`0x${hwnd}`).toString(10);
      const snapshot = await readWindowAccessibility(targetHandle);
      const panels = buildPanelText(snapshot);
      if (!panels.instructions && !panels.code) {
        throw new Error('The target window did not expose readable text through Windows accessibility.');
      }
      return {
        ok: true,
        ...panels,
        windowName: hwnd,
        bounds: snapshot.bounds,
        truncated: panels.truncated,
      };
    } catch (error) {
      console.error('[live-coding-capture] failed:', error);
      return { ok: false, error: error.message || 'Could not read the target window.' };
    }
  });

  ipcMain.handle('live-coding-capture-screenshot', async (_event, targetScreenshotId = '') => {
    try {
      const hwnd = getLastExternalWindowHandle();
      if (!hwnd) throw new Error('No target window found. Focus the challenge window and retry the screenshot.');
      const targetHandle = BigInt(`0x${hwnd}`).toString(10);
      const screenshot = await captureLiveCodingScreenshotPart(targetHandle);
      return { ok: true, ...(await saveLiveCodingScreenshot(screenshot, targetScreenshotId)) };
    } catch (error) {
      console.error('[live-coding-screenshot] failed:', error);
      return { ok: false, error: error.message || 'Could not capture the target window.' };
    }
  });

  ipcMain.handle('live-coding-end-session', endLiveCodingScreenshotSession);

  ipcMain.handle('live-coding-window-mode', (event, mode) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false };
    if (mode === 'expanded') {
      if (!liveCodingWindowBounds.has(win.id)) {
        liveCodingWindowBounds.set(win.id, {
          bounds: win.getBounds(),
          wasMaximized: win.isMaximized(),
        });
      }
      if (!win.isMaximized()) win.maximize();
      return { ok: true, bounds: win.getBounds() };
    }
    if (mode === 'restore') {
      const previous = liveCodingWindowBounds.get(win.id);
      if (previous) {
        if (win.isMaximized()) win.unmaximize();
        if (previous.wasMaximized) win.maximize();
        else win.setBounds(previous.bounds);
        liveCodingWindowBounds.delete(win.id);
      }
      return { ok: true, bounds: win.getBounds() };
    }
    return { ok: false, error: 'Unknown live-coding window mode.' };
  });

  app.once('will-quit', () => {
    if (liveCodingTempDirectory) {
      try { fs.rmSync(liveCodingTempDirectory, { recursive: true, force: true }); } catch (error) {
        console.warn('[live-coding] Could not remove temporary screenshots during shutdown:', error.message);
      }
      liveCodingTempDirectory = null;
      liveCodingScreenshotSlots.clear();
    }
  });

  ipcMain.handle('live-coding-reconstruct-screenshots', async (_event, screenshots = []) => {
    try {
      if (!Array.isArray(screenshots) || screenshots.length < 1 || screenshots.length > 20) {
        throw new Error('Capture between 1 and 20 viewport screenshots before reconstruction.');
      }
      const validScreenshots = screenshots.filter((item) =>
        /^S\d{2}$/.test(item?.screenshotId || '') && Number.isInteger(item?.revision) &&
        item?.imagePart?.inline_data?.mime_type === 'image/jpeg' && typeof item.imagePart.inline_data.data === 'string'
      );
      if (validScreenshots.length !== screenshots.length) throw new Error('One or more screenshot captures are invalid. Capture them again.');
      const imageParts = validScreenshots.map((item) => item.imagePart);
      const totalBytes = imageParts.reduce((total, part) => total + Math.ceil(part.inline_data.data.length * 3 / 4), 0);
      if (totalBytes > 12 * 1024 * 1024) throw new Error('The screenshot set is too large. Use fewer, overlapping viewport captures.');

      const requestParts = [{ text: `Analyze all ${validScreenshots.length} full-window screenshots in capture order. Reconstruct the complete scrollable instructions and code, solve the task, and return the best-effort full solution plus targeted recapture requests if needed. The active revision for each screenshot ID is shown immediately before its image.` }];
      for (const screenshot of validScreenshots) {
        requestParts.push({ text: `SCREENSHOT ${screenshot.screenshotId} REVISION ${screenshot.revision} — full active window; left instruction pane and right code editor.` });
        requestParts.push(screenshot.imagePart);
      }
      const { text, codeExecutionResults = [], codeExecutionUnavailable = false } = await queryLiveCodingWithOptionalPythonExecution({
        history: [],
        systemInstruction: SCREENSHOT_RECONSTRUCTION_PROMPT,
        // Gemini currently rejects JSON response MIME mode together with built-in tools.
        // The isolated live-coding prompt still requires a JSON object, which is validated below.
        parts: requestParts,
      });
      const reconstruction = parseScreenshotReconstruction(text);
      reconstruction.validation = reconstruction.validation || { method: 'not_run', tests: [], limitations: [] };
      if (codeExecutionResults.length) {
        reconstruction.validation.method = reconstruction.language?.toLowerCase() === 'python' ? 'python_execution' : 'not_run';
        reconstruction.validation.executionOutputs = codeExecutionResults.map((result) => ({
          outcome: result.outcome || 'unknown',
          output: String(result.output || '').slice(0, 12_000),
        }));
        if (reconstruction.language?.toLowerCase() !== 'python') {
          reconstruction.validation.limitations = [...(reconstruction.validation.limitations || []), 'Gemini code execution only ran Python; it did not execute the target-language solution.'];
        }
      } else if (reconstruction.validation.method === 'python_execution') {
        reconstruction.validation.method = 'static_review';
        reconstruction.validation.limitations = [...(reconstruction.validation.limitations || []), 'Gemini returned no code-execution result; Python execution is unverified.'];
      }
      if (codeExecutionUnavailable) {
        reconstruction.validation.method = 'static_review';
        reconstruction.validation.limitations = [...(reconstruction.validation.limitations || []), 'The selected Gemini model did not support the Python execution tool; code was not executed.'];
      }
      return {
        ok: true,
        ...reconstruction,
      };
    } catch (error) {
      console.error('[live-coding-reconstruct-screenshots] failed:', error);
      return { ok: false, error: error.message || 'Could not reconstruct the screenshots.' };
    }
  });

  ipcMain.handle('live-coding-generate-patch', async (_event, payload = {}) => {
    try {
      const instructions = String(payload.instructions || '').trim();
      const code = String(payload.code || '');
      if (!instructions) throw new Error('No instruction text was captured. Retry Ctrl+I or inspect the accessibility capture.');
      if (!code.trim()) throw new Error('No code text was captured. The editor may not expose its source through accessibility.');
      if (code.length > 160_000 || instructions.length > 60_000) {
        throw new Error('The captured text is too large for one patch request. Reduce unrelated page text and retry.');
      }
      const screenshots = Array.isArray(payload.screenshots) ? payload.screenshots : [];
      if (screenshots.length > 20) throw new Error('Too many screenshot references; keep the capture set to 20 or fewer.');
      const screenshotParts = [];
      for (const screenshot of screenshots) {
        if (screenshot?.imagePart?.inline_data?.mime_type !== 'image/jpeg' || typeof screenshot.imagePart.inline_data.data !== 'string') {
          throw new Error('One or more screenshot references are invalid. Capture them again.');
        }
        if (screenshot.screenshotId && Number.isInteger(screenshot.revision)) {
          screenshotParts.push({ text: `SCREENSHOT ${screenshot.screenshotId} REVISION ${screenshot.revision} — full active window with instruction and code panes.` });
        }
        screenshotParts.push(screenshot.imagePart);
      }

      const { text, codeExecutionResults = [], codeExecutionUnavailable = false } = await queryLiveCodingWithOptionalPythonExecution({
        history: [],
        systemInstruction: LIVE_CODING_SYSTEM_PROMPT,
        // Tool calls and JSON response MIME mode are not supported together by Gemini.
        parts: [
          { text: `CAPTURE LIMITATION: Full off-screen source coverage is unverified unless the user reviewed the capture. Do not assume unseen source. Use screenshots, when supplied, as full-window evidence: the instruction pane may scroll independently from the editor, and each capture may contain a different portion of the same instructions.\n\nTASK INSTRUCTIONS (left pane):\n${instructions}\n\nSOURCE CODE (editor):\n${code}\n\nReturn exact minimal edits in the required JSON format. If evidence is incomplete, still provide a best-effort safe patch and targeted recapture requests; mark assumptions and status provisional.` },
          ...screenshotParts,
        ],
      });
      const patch = parsePatchResponse(text);
      if (!patch.edits.length) {
        return {
          ok: true,
          needsMoreSource: true,
          summary: patch.summary || 'The available text does not appear sufficient for a safe patch.',
          assumptions: patch.assumptions,
          sourceConcerns: patch.sourceConcerns,
          recaptureRequests: patch.recaptureRequests,
        };
      }
      const applied = applyPatch(code, patch.edits);
      const validation = patch.validation || { method: 'not_run', tests: [], limitations: [] };
      if (codeExecutionResults.length) {
        validation.method = String(patch.language || '').toLowerCase() === 'python' ? 'python_execution' : 'not_run';
        validation.executionOutputs = codeExecutionResults.map((result) => ({
          outcome: result.outcome || 'unknown',
          output: String(result.output || '').slice(0, 12_000),
        }));
        if (String(patch.language || '').toLowerCase() !== 'python') {
          validation.limitations = [...(validation.limitations || []), 'Gemini code execution only ran Python; it did not execute the target-language solution.'];
        }
      } else if (validation.method === 'python_execution') {
        validation.method = 'static_review';
        validation.limitations = [...(validation.limitations || []), 'Gemini returned no code-execution result; Python execution is unverified.'];
      }
      if (codeExecutionUnavailable) {
        validation.method = 'static_review';
        validation.limitations = [...(validation.limitations || []), 'The selected Gemini model did not support the Python execution tool; code was not executed.'];
      }
      return {
        ok: true,
        code: applied.code,
        changedLines: applied.changedLines,
        assumedLines: applied.assumedLines,
        status: patch.status,
        summary: patch.summary || 'Patch applied.',
        assumptions: patch.assumptions,
        sourceConcerns: patch.sourceConcerns,
        recaptureRequests: patch.recaptureRequests,
        validation,
      };
    } catch (error) {
      console.error('[live-coding-generate-patch] failed:', error);
      return { ok: false, error: error.message || 'Could not generate or apply the patch.' };
    }
  });

  ipcMain.handle('get-job-session-status', () => interviewSession.getStatus());

  ipcMain.handle('start-job-session', async (_event, payload) => {
    try {
      if (!String(payload?.jobName || '').trim()) {
        throw new Error('Enter a job name.');
      }
      if (!String(payload?.jobDescription || '').trim()) {
        throw new Error('Enter the job description or requirements.');
      }
      if (!String(payload?.requiredSkills || '').trim()) {
        throw new Error('Enter the required skills.');
      }
      const status = await interviewSession.startSession({
        documentsPath: app.getPath('documents'),
        jobName: payload.jobName,
        jobDescription: payload.jobDescription,
        requiredSkills: payload.requiredSkills,
        options: payload.options,
        primaryPrompt: interviewPrompts.PRIMARY_SCREEN_PROMPT,
        model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      });

      if (!payload.options?.useContext) {
        return { ok: true, status };
      }

      try {
        const budget = await buildSessionContext(payload);
        return { ok: true, status: interviewSession.getStatus(), budget };
      } catch (contextError) {
        console.error('[job-session] context compaction failed:', contextError);
        return {
          ok: true,
          status: interviewSession.getStatus(),
          contextError: contextError.message || 'Context compaction failed',
        };
      }
    } catch (err) {
      console.error('[job-session] start failed:', err);
      return { ok: false, error: err.message || 'Could not start job session.' };
    }
  });

  ipcMain.handle('retry-job-context', async () => {
    try {
      const details = interviewSession.getJobDetails();
      if (!details) throw new Error('No job session is active.');
      if (!details.options.useContext) throw new Error('Job context is disabled for this session.');
      const budget = await buildSessionContext(details);
      return { ok: true, status: interviewSession.getStatus(), budget };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not create job context.' };
    }
  });

  ipcMain.handle('end-job-session', async () => {
    try {
      return { ok: true, ...await interviewSession.endSession() };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not finish job session.' };
    }
  });

  ipcMain.handle('retry-job-session-save', async () => {
    try {
      return await interviewSession.retryPendingWrites();
    } catch (err) {
      return { ok: false, error: err.message || 'Could not retry session save.' };
    }
  });

ipcMain.handle(
  'save-screen-recording',
  async (event, { arrayBuffer, mimeType }) => {
    try {
      const recordingsDir = path.join(
        __dirname,
        '..',
        'data',
        'recordings'
      );

      await fs.promises.mkdir(recordingsDir, {
        recursive: true,
      });

      // Normalize IPC data into a Buffer
      let buffer;

      if (Buffer.isBuffer(arrayBuffer)) {
        buffer = arrayBuffer;
      } else if (arrayBuffer instanceof ArrayBuffer) {
        buffer = Buffer.from(arrayBuffer);
      } else if (
        arrayBuffer?.type === 'Buffer' &&
        Array.isArray(arrayBuffer.data)
      ) {
        buffer = Buffer.from(arrayBuffer.data);
      } else if (arrayBuffer?.data && Array.isArray(arrayBuffer.data)) {
        buffer = Buffer.from(arrayBuffer.data);
      } else if (Array.isArray(arrayBuffer)) {
        buffer = Buffer.from(arrayBuffer);
      } else {
        throw new TypeError('Invalid recording data received');
      }

      const timestamp = Date.now();

      const inputPath = path.join(
        recordingsDir,
        `recording-${timestamp}-raw.webm`
      );

      const outputPath = path.join(
        recordingsDir,
        `recording-${timestamp}.webm`
      );

      // Save raw recording
      await fs.promises.writeFile(inputPath, buffer);

      console.log('[screen-recording] Raw file:', inputPath);

      // Finalize/remux WebM so seeking works correctly
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
          '-y',

          '-i',
          inputPath,

          // Keep video
          '-map',
          '0:v:0',

          // Keep audio if present
          '-map',
          '0:a?',

          // Do not re-encode
          '-c:v',
          'copy',

          '-c:a',
          'copy',

          // Generate proper timestamps
          '-fflags',
          '+genpts',

          // Make timestamps start cleanly
          '-avoid_negative_ts',
          'make_zero',

          outputPath,
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('error', reject);

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                `FFmpeg failed with code ${code}: ${stderr.slice(-2000)}`
              )
            );
          }
        });
      });

      // Remove raw file
      await fs.promises.unlink(inputPath);

      console.log(
        '[screen-recording] Finalized:',
        outputPath
      );

      return {
        ok: true,
        filePath: outputPath,
      };
    } catch (err) {
      console.error(
        '[screen-recording] Finalization failed:',
        err
      );

      return {
        ok: false,
        error: err.message || 'Failed to save recording',
      };
    }
  }
);
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
   // Screen recognition — capture the active external application window
  ipcMain.handle('gemini-screen-query', async (event, userPrompt) => {
    const startedAt = Date.now();
    let sessionQuestion = null;
    const geminiStartedAt = Date.now();

    try {
      const hwnd = getLastExternalWindowHandle();

      if (!hwnd) {
        throw new Error(
          'No active application window detected. Click the app you want to read, then try again.'
        );
      }

      const targetHandle = BigInt(`0x${hwnd}`).toString(10);

      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1280, height: 900 },
      });

      const source = sources.find((item) => {
        const match = item.id.match(/^window:(\d+):/);
        return match && match[1] === targetHandle;
      });

      if (!source) {
        throw new Error(
          'Could not find the active window. Click the target application and try again.'
        );
      }

      console.log('[SCREEN] Target window:', source.name);

      const imagePart = await captureWindowSourcePart(source.id);
      console.log('[SCREEN] Capture total:', Date.now() - startedAt, 'ms');

      if (interviewSession.getStatus().active) {
        sessionQuestion = interviewSession.beginQuestion(imagePart.inline_data.data);
        sessionQuestion?.writePromise.catch((err) => {
          console.error('[job-session] screenshot save failed:', err);
          if (!event.sender.isDestroyed()) {
            event.sender.send('job-session-error', {
              message: `Could not save screenshot ${sessionQuestion.number}: ${err.message}`,
            });
          }
        });
      }

      const promptText =
        userPrompt && userPrompt.trim()
          ? userPrompt
          : interviewPrompts.PRIMARY_SCREEN_PROMPT;
      const context = interviewSession.getRequestContext();
      const transcribeQuestion = interviewSession.shouldTranscribeQuestion();
      const requestParts = [promptText];
      if (context) requestParts.push(`Job context:\n${context}`);
      if (transcribeQuestion) {
        requestParts.push(interviewPrompts.QUESTION_TRANSCRIPTION_INSTRUCTION);
      }

      const { text, usageMetadata, modelVersion } = await geminiClient.query({
        history: [],
        parts: [...requestParts.map((text) => ({ text })), imagePart],
        systemInstruction: SYSTEM_INSTRUCTION,
      });

      const parsed = transcribeQuestion
        ? parseQuestionAndAnswer(text)
        : { question: null, answer: text };
      if (parsed.unparsed) {
        throw new Error('Gemini response could not be separated into question and spoken answer. Retry the screenshot.');
      }

      console.log('[SCREEN] Gemini request:', Date.now() - geminiStartedAt, 'ms');
      console.log('[SCREEN] Total request:', Date.now() - startedAt, 'ms');

      if (sessionQuestion) {
        interviewSession.finishQuestion(sessionQuestion, {
          question: parsed.question,
          answer: parsed.answer,
          status: 'answered',
          latencyMs: Date.now() - geminiStartedAt,
          inputTokens: usageMetadata?.promptTokenCount,
          modelVersion,
        }).catch((err) => {
          console.error('[job-session] answer save failed:', err);
          if (!event.sender.isDestroyed()) {
            event.sender.send('job-session-error', {
              message: `Could not save answer ${sessionQuestion.number}: ${err.message}`,
            });
          }
        });
      }

      return { ok: true, text: parsed.answer };
    } catch (err) {
      console.error('[gemini-screen-query] failed:', err);

      if (sessionQuestion) {
        interviewSession.finishQuestion(sessionQuestion, {
          question: null,
          answer: null,
          status: 'failed',
          error: err.message || 'Unknown error',
          latencyMs: Date.now() - geminiStartedAt,
        }).catch((saveError) => {
          console.error('[job-session] failed-request save failed:', saveError);
          if (!event.sender.isDestroyed()) {
            event.sender.send('job-session-error', {
              message: `Could not save failed question ${sessionQuestion.number}: ${saveError.message}`,
            });
          }
        });
      }

      return {
        ok: false,
        error: err.message || 'Unknown error',
      };
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
      'You will get diffenet type of inputs'+
      'if the input is a normal input give a responce depending on the nature of the input followup question or preceeding questions'+
      'if the input is programming related follow this inustraction'+
      'You are a senior interview coach and technical communication expert. ' +
'You receive interview questions in real time through transcripts or speech. ' +
'Your job is to generate the best possible answer that a strong candidate with the user\'s background would naturally give. ' +
'The uploaded CV is the single source of truth for the candidate\'s experience. ' +
'Rules ' +
'- Base every answer on the CV and current interview context. ' +
'- Never invent experience, companies, technologies, projects, certifications, degrees, or achievements that are not supported by the CV. ' +
'- If experience is limited, emphasize transferable skills, learning ability, analytical thinking, and relevant projects. ' +
'- Never contradict previous answers. ' +
'- Sound like a real person speaking naturally, not like an AI or a memorized script. ' +
'Speaking Style ' +
'- Conversational and confident. ' +
'- Professional but warm. ' +
'- Natural spoken English. ' +
'- Use contractions naturally (I\'m, I\'ve, I\'d, that\'s, etc.). ' +
'- Avoid buzzwords and corporate clichés. ' +
'- Avoid sounding overly polished. ' +
'- Include small natural pauses using punctuation when appropriate. ' +
'- Never sound robotic. ' +
'Answer Length ' +
'- Never be longer than necessary. ' +
'Behavioral Questions ' +
'Use a natural STAR structure without labeling it. ' +
'Describe: ' +
'- Situation ' +
'- Responsibility ' +
'- Action ' +
'- Result ' +
'- Lesson learned ' +
'Always emphasize: ' +
'- ownership ' +
'- collaboration ' +
'- communication ' +
'- adaptability ' +
'- problem solving ' +
'- attention to detail ' +
'Technical Questions ' +
'Answer like a software engineer. ' +
'Explain: ' +
'- the idea first ' +
'- then the reasoning ' +
'- then practical considerations ' +
'Avoid unnecessary theory. ' +
'Coding Questions ' +
'If asked to solve a coding problem: ' +
'1. Produce the optimal solution. ' +
'2. Mention time and space complexity briefly if appropriate. ' +
'3. Explain the approach in plain English as if talking to the interviewer. ' +
'AI Training Questions ' +
'When discussing AI: ' +
'Emphasize: ' +
'- instruction following ' +
'- factual accuracy ' +
'- reasoning ' +
'- ranking responses ' +
'- prompt quality ' +
'- evaluation criteria ' +
'- data quality ' +
'- attention to detail ' +
'- human feedback ' +
'Technical Writing ' +
'Write clearly. ' +
'Avoid unnecessary words. ' +
'Be precise. ' +
'Interview Personality ' +
'The candidate should sound: ' +
'- curious ' +
'- thoughtful ' +
'- honest ' +
'- confident ' +
'- collaborative ' +
'- analytical ' +
'- detail-oriented ' +
'Never sound arrogant. ' +
'Never sound rehearsed. ' +
'If the candidate does not know something: ' +
'Respond honestly. ' +
'Briefly explain what you do know. ' +
'Describe how you would learn or investigate it. ' +
'Do not guess. ' +
'Context Priority ' +
'1. Latest interview question ' +
'2. Uploaded CV ' +
'3. Previous interview answers ' +
'4. Screen content ' +
'5. Transcript ' +
'Final Goal ' +
'Generate answers that sound like they come from a capable junior software engineer with strong communication skills. ' +
'Every answer should be truthful, technically accurate, conversational, and consistent with the candidate\'s background, leaving the interviewer with confidence in the candidate\'s reasoning and professionalism.' 
'Finaaly here is my CV'+
'Naol Girma ' +
'Adama, Ethiopia | naolggonfa@gmail.com | +251993270601 | GitHub | Portfolio ' +
'Professional Summary ' +
'Computer Science and Engineering student with full-stack development experience using React, ' +
'Next.js, Node.js, Express.js, and PostgreSQL. Strong English communication, code review, ' +
'debugging, and technical documentation skills. Passionate about AI systems, prompt engineering, ' +
'AI response evaluation, and software quality assurance. Seeking remote AI Training, AI Coding ' +
'Evaluator, Prompt Evaluator, and Data Annotation roles. ' +
'Technical Skills ' +
'Languages: JavaScript, TypeScript, SQL, HTML5, CSS3, Dart, Kotlin ' +
'Frameworks: React, Next.js, Node.js, Express.js, React Native ' +
'Databases: PostgreSQL, Supabase ' +
'Tools: Git, GitHub, VS Code, Postman, Docker (basic), Linux (Ubuntu), npm, Figma ' +
'AI Tools: ChatGPT, Claude, Gemini, GitHub Copilot, Cursor IDE, Perplexity AI ' +
'AI Skills: Prompt Engineering, AI Response Evaluation, Code Review, Technical Writing, Bug ' +
'Identification, Software Testing, Data Validation, Search Evaluation ' +
'Experience ' +
'Software Engineering Intern – Helder Technology Solutions ' +
'Collaborated on client projects, implemented features, debugged applications, participated in code ' +
'reviews, and delivered work under deadlines. ' +
'Projects ' +
'• Agricultural Investment Platform (React, Node.js, PostgreSQL) ' +
'• ETX Ethiopia Conference Website ' +
'• React Car Showcase Application ' +
'Core Competencies ' +
'Analytical Thinking • Problem Solving • Remote Collaboration • Attention to Detail • Documentation ' +
'• REST APIs • Database Design • AI Model Evaluation • Quality Assurance'+
'and here is my cv'+ cv_prompt ;

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
