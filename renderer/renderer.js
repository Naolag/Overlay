// --- Capture-exclusion status (Day 1) ---

async function updateStatus() {
  const statusEl = document.getElementById('status');
  try {
    const excluded = await window.overlayAPI.getExclusionStatus();
    if (excluded) {
      statusEl.textContent = '✓ Excluded from capture';
      statusEl.className = 'status-ok';
    } else {
      statusEl.textContent = '✗ NOT excluded — do not trust this window on a real call';
      statusEl.className = 'status-bad';
    }
  } catch (err) {
    statusEl.textContent = '✗ Could not check status: ' + err.message;
    statusEl.className = 'status-bad';
  }
}

updateStatus();
setInterval(updateStatus, 3000);

// --- Gemini chat (Day 2) ---

const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

function appendEntry(role, text, isError = false) {
  const entry = document.createElement('div');
  entry.className = 'chat-entry';

  const roleEl = document.createElement('div');
  roleEl.className = `chat-role role-${role === 'You' ? 'you' : 'gemini'}`;
  roleEl.textContent = role;

  const textEl = document.createElement('div');
  textEl.className = isError ? 'chat-text chat-error' : 'chat-text';
  textEl.textContent = text;

  entry.appendChild(roleEl);
  entry.appendChild(textEl);
  chatLog.appendChild(entry);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function handleSend(event) {
  event.preventDefault();
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  appendEntry('You', prompt);
  chatInput.value = '';
  chatSend.disabled = true;
  chatSend.textContent = '...';

  const result = await window.overlayAPI.sendQuery(prompt);

  if (result.ok) {
    appendEntry('Gemini', result.text);
  } else {
    appendEntry('Gemini', result.error, true);
  }

  chatSend.disabled = false;
  chatSend.textContent = 'Send';
  chatInput.focus();
}

chatForm.addEventListener('submit', handleSend);

// --- Optional interview job session ---

const jobSessionDialog = document.getElementById('job-session-dialog');
const jobSessionForm = document.getElementById('job-session-form');
const jobSessionStatus = document.getElementById('job-session-status');
const startJobSessionBtn = document.getElementById('start-job-session-btn');
const endJobSessionBtn = document.getElementById('end-job-session-btn');
const retryJobContextBtn = document.getElementById('retry-job-context-btn');
const retrySessionSaveBtn = document.getElementById('retry-session-save-btn');
const jobSessionFormError = document.getElementById('job-session-form-error');
const confirmJobSessionBtn = document.getElementById('confirm-job-session-btn');

function updateJobSessionUI(status) {
  const active = Boolean(status?.active);
  jobSessionStatus.textContent = active
    ? `${status.jobName} · ${status.questionCount} saved question(s)`
    : 'Job session off';
  startJobSessionBtn.hidden = active;
  endJobSessionBtn.hidden = !active;
  retryJobContextBtn.hidden = !(
    active && status.options?.useContext && !status.contextReady
  );
}

startJobSessionBtn.addEventListener('click', () => {
  jobSessionFormError.textContent = '';
  jobSessionDialog.showModal();
});

document.getElementById('cancel-job-session-btn').addEventListener('click', () => {
  jobSessionDialog.close();
});

jobSessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  jobSessionFormError.textContent = '';
  confirmJobSessionBtn.disabled = true;
  confirmJobSessionBtn.textContent = 'Preparing…';

  const payload = {
    jobName: document.getElementById('job-name-input').value.trim(),
    jobDescription: document.getElementById('job-description-input').value,
    requiredSkills: document.getElementById('required-skills-input').value,
    options: {
      useContext: document.getElementById('job-context-enabled').checked,
      transcribeQuestion: document.getElementById('question-transcription-enabled').checked,
    },
  };

  try {
    const result = await window.overlayAPI.startJobSession(payload);
    if (!result.ok) throw new Error(result.error);
    jobSessionDialog.close();
    updateJobSessionUI(result.status);
    appendEntry(
      'System',
      result.contextError
        ? `⚠ Job session started, but compact context could not be created: ${result.contextError}. The interview still works without context; retry it from the session bar.`
        : `Job session started. Files are being saved under Documents\\Overlay Job Sessions${result.budget ? ` · context ${result.budget.tokenCount}/${result.budget.tokenLimit} tokens` : ''}.`
    );
  } catch (err) {
    jobSessionFormError.textContent = err.message || 'Could not start session.';
  } finally {
    confirmJobSessionBtn.disabled = false;
    confirmJobSessionBtn.textContent = 'Start session';
  }
});

retryJobContextBtn.addEventListener('click', async () => {
  retryJobContextBtn.disabled = true;
  retryJobContextBtn.textContent = 'Retrying…';
  const result = await window.overlayAPI.retryJobContext();
  if (result.ok) {
    updateJobSessionUI(result.status);
    appendEntry('System', `Job context saved (${result.budget.tokenCount}/${result.budget.tokenLimit} tokens).`);
  } else {
    appendEntry('System', `⚠ Context retry failed: ${result.error}`, true);
  }
  retryJobContextBtn.disabled = false;
  retryJobContextBtn.textContent = 'Retry context';
});

endJobSessionBtn.addEventListener('click', async () => {
  endJobSessionBtn.disabled = true;
  const result = await window.overlayAPI.endJobSession();
  if (result.ok) {
    updateJobSessionUI({ active: false });
    appendEntry('System', `Job session saved: ${result.directory}`);
  } else {
    appendEntry('System', `⚠ Could not finish job session: ${result.error}`, true);
  }
  endJobSessionBtn.disabled = false;
});

retrySessionSaveBtn.addEventListener('click', async () => {
  retrySessionSaveBtn.disabled = true;
  const result = await window.overlayAPI.retrySessionSave();
  if (result.ok) {
    retrySessionSaveBtn.hidden = true;
    appendEntry('System', 'Session files saved successfully.');
  } else {
    appendEntry('System', `⚠ Session save retry failed: ${result.error}`, true);
  }
  retrySessionSaveBtn.disabled = false;
});

window.overlayAPI.onJobSessionError(({ message }) => {
  appendEntry('System', `⚠ ${message} The interview response flow continues.`, true);
  retrySessionSaveBtn.hidden = false;
});

window.overlayAPI.getJobSessionStatus().then(updateJobSessionUI);

// Enter sends, Shift+Enter adds a newline
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// --- Self-test loop support (Day 5) ---

async function setWatermark() {
  try {
    const color = await window.overlayAPI.getWatermarkColor();
    if (color) {
      document.getElementById('watermark').style.backgroundColor =
        `rgb(${color.r}, ${color.g}, ${color.b})`;
    }
  } catch (err) {
    console.error('Could not set watermark color:', err);
  }
}
setWatermark();

function clearChatLog() {
  chatLog.innerHTML = '';
}

function showWarningBanner(timestamp) {
  const banner = document.getElementById('warning-banner');
  banner.innerHTML =
    `⚠ Exposure detected at ${timestamp}. Content was cleared automatically.<br>` +
    `Do not resume use until you've investigated (see TESTING.md).<br>` +
    `<button id="ack-exposure">I've investigated — resume</button>`;
  banner.style.display = 'block';

  document.getElementById('ack-exposure').addEventListener('click', async () => {
    await window.overlayAPI.resetSelfTest();
    banner.style.display = 'none';
  });
}

// Check on load whether we're reopening after a past exposure event
window.overlayAPI.getLastExposureEvent().then((event) => {
  if (event) showWarningBanner(event.timestamp);
});

window.overlayAPI.onExposureDetected(({ timestamp }) => {
  clearChatLog();
  showWarningBanner(timestamp);
});

window.overlayAPI.onClearContent(() => {
  clearChatLog();
});

// --- Screen recognition ---

const readScreenBtn = document.getElementById('read-screen-btn');

async function handleReadScreen() {
  appendEntry('You', '📷 (reading screen…)');
  readScreenBtn.disabled = true;

  const result = await window.overlayAPI.sendScreenQuery('');

  if (result.ok) {
    appendEntry('Gemini', result.text);
  } else {
    appendEntry('Gemini', result.error, true);
  }
  // Refresh status after rendering the answer; this must not delay the live answer.
  window.overlayAPI.getJobSessionStatus().then(updateJobSessionUI);
  readScreenBtn.disabled = false;
}

readScreenBtn.addEventListener('click', handleReadScreen);
window.overlayAPI.onTriggerReadScreen(handleReadScreen);

// --- Isolated live-coding workflow (Ctrl+I) ---

const liveCodingDialog = document.getElementById('live-coding-dialog');
const liveCodingWorkspace = document.getElementById('live-coding-workspace');
const liveCodingShortcuts = document.getElementById('live-coding-shortcuts');
const liveCodingStatus = document.getElementById('live-coding-status');
const liveCodingInstructions = document.getElementById('live-coding-instructions');
const liveCodingSource = document.getElementById('live-coding-source');
const liveCodingCompleteConfirmation = document.getElementById('live-coding-complete-confirmation');
const liveCodingCaptureBtn = document.getElementById('retry-live-coding-capture-btn');
const liveCodingGenerateBtn = document.getElementById('generate-live-coding-patch-btn');
const liveCodingCopyBtn = document.getElementById('copy-live-coding-code-btn');
const liveCodingReview = document.getElementById('live-coding-review');
const liveCodingOutput = document.getElementById('live-coding-output');
const liveCodingOriginalOutput = document.getElementById('live-coding-original-output');
const liveCodingScreenshotControls = document.getElementById('live-coding-screenshot-controls');
const startLiveCodingScreenshotsBtn = document.getElementById('start-live-coding-screenshots-btn');
const captureLiveCodingViewportBtn = document.getElementById('capture-live-coding-viewport-btn');
const reconstructLiveCodingScreenshotsBtn = document.getElementById('reconstruct-live-coding-screenshots-btn');
const liveCodingScreenshotCount = document.getElementById('live-coding-screenshot-count');
const liveCodingRetakeTarget = document.getElementById('live-coding-retake-target');
const liveCodingRetakeBtn = document.getElementById('retake-live-coding-screenshot-btn');
const liveCodingEndSessionBtn = document.getElementById('end-live-coding-session-btn');
let liveCodingResult = null;
let liveCodingCaptureTruncated = false;
let liveCodingScreenshotMode = false;
let liveCodingScreenshotParts = [];
let liveCodingScreenshotReconstructionReady = false;
let liveCodingRecaptureRequests = [];
let liveCodingAnalyzing = false;

async function captureLiveCodingSource() {
  try { await window.overlayAPI.endLiveCodingSession(); } catch (_) { /* A new capture can proceed if stale temp cleanup fails. */ }
  liveCodingWorkspace.classList.remove('screenshot-mode');
  liveCodingShortcuts.hidden = true;
  liveCodingStatus.textContent = 'Reading the focused window through read-only accessibility…';
  liveCodingCaptureBtn.disabled = true;
  liveCodingGenerateBtn.disabled = true;
  liveCodingCopyBtn.hidden = true;
  liveCodingReview.hidden = true;
  liveCodingInstructions.value = '';
  liveCodingSource.value = '';
  liveCodingCompleteConfirmation.checked = false;
  liveCodingResult = null;
  liveCodingCaptureTruncated = false;
  liveCodingScreenshotMode = false;
  liveCodingScreenshotParts = [];
  liveCodingScreenshotReconstructionReady = false;
  liveCodingRecaptureRequests = [];
  startLiveCodingScreenshotsBtn.hidden = false;
  captureLiveCodingViewportBtn.hidden = true;
  liveCodingScreenshotCount.textContent = '0 screenshots';
  liveCodingScreenshotControls.hidden = false;
  liveCodingEndSessionBtn.hidden = true;
  liveCodingCompleteConfirmation.closest('label').hidden = false;
  liveCodingCaptureBtn.hidden = false;
  liveCodingGenerateBtn.hidden = false;
  liveCodingRetakeTarget.hidden = true;
  liveCodingRetakeBtn.hidden = true;
  reconstructLiveCodingScreenshotsBtn.disabled = true;
  startLiveCodingScreenshotsBtn.disabled = true;

  let result;
  try {
    result = await window.overlayAPI.captureLiveCodingWindow();
  } catch (error) {
    liveCodingStatus.textContent = `Capture failed: ${error.message || 'Accessibility reader error.'}`;
    liveCodingCaptureBtn.disabled = false;
    startLiveCodingScreenshotsBtn.disabled = false;
    return;
  }
  if (!result.ok) {
    liveCodingStatus.textContent = `Capture failed: ${result.error}`;
    liveCodingCaptureBtn.disabled = false;
    startLiveCodingScreenshotsBtn.disabled = false;
    return;
  }

  liveCodingInstructions.value = result.instructions || '';
  liveCodingSource.value = result.code || '';
  liveCodingScreenshotReconstructionReady = Boolean(result.instructions?.trim() && result.code?.trim());
  liveCodingCaptureTruncated = Boolean(result.truncated);
  const flags = [];
  if (result.truncated) flags.push('Accessibility text was truncated at the capture limit.');
  if (!result.instructions) flags.push('No text was found on the left side.');
  if (!result.code) flags.push('No text was found on the right side.');
  liveCodingStatus.textContent = `Captured ${result.instructions.length.toLocaleString()} instruction characters and ${result.code.length.toLocaleString()} code characters from ${result.candidateCount} accessible text controls. This editor’s off-screen coverage has not been verified.`;
  if (flags.length) liveCodingStatus.textContent += `\n${flags.join(' ')}`;
  liveCodingGenerateBtn.disabled = true;
  liveCodingCaptureBtn.disabled = false;
  startLiveCodingScreenshotsBtn.disabled = false;
}

liveCodingCompleteConfirmation.addEventListener('change', () => {
  liveCodingGenerateBtn.disabled = !liveCodingCompleteConfirmation.checked ||
    !liveCodingInstructions.value.trim() || !liveCodingSource.value.trim() || liveCodingCaptureTruncated || !liveCodingScreenshotReconstructionReady;
});

function renderLiveCodingCode(result) {
  const changed = new Set(result.changedLines || []);
  const assumed = new Set(result.assumedLines || []);
  const renderPane = (element, code, edited = false) => {
    const fragment = document.createDocumentFragment();
    String(code || '').split('\n').forEach((line, index) => {
      const row = document.createElement('div');
      row.className = 'live-code-line';
      if (edited && assumed.has(index)) row.classList.add('assumed');
      else if (edited && changed.has(index)) row.classList.add('changed');
      const number = document.createElement('span');
      number.className = 'live-code-number';
      number.textContent = String(index + 1);
      const content = document.createElement('span');
      content.className = 'live-code-text';
      content.textContent = line || ' ';
      row.append(number, content);
      fragment.appendChild(row);
    });
    element.replaceChildren(fragment);
    element.scrollTop = 0;
    element.scrollLeft = 0;
  };
  renderPane(liveCodingOriginalOutput, liveCodingSource.value);
  renderPane(liveCodingOutput, result.code, true);
}

async function startLiveCoding() {
  if (liveCodingScreenshotMode) {
    try { await window.overlayAPI.setLiveCodingWindowMode('expanded'); } catch (_) { /* Keep the original bounds if expansion fails. */ }
    if (!liveCodingDialog.open) liveCodingDialog.showModal();
    const targetId = liveCodingRecaptureRequests.length ? liveCodingRetakeTarget.value : '';
    await captureLiveCodingScreenshot(true, targetId);
    return;
  }
  await beginScreenshotFallback();
}

liveCodingCaptureBtn.addEventListener('click', captureLiveCodingSource);
document.getElementById('close-live-coding-btn').addEventListener('click', () => liveCodingDialog.close());
liveCodingDialog.addEventListener('close', () => {
  window.overlayAPI.setLiveCodingWindowMode('restore').catch(() => {});
});
window.overlayAPI.onTriggerLiveCoding(startLiveCoding);
window.overlayAPI.onTriggerLiveCodingAnalyze(analyzeLiveCodingScreenshots);
window.overlayAPI.onTriggerLiveCodingEnd(endLiveCodingSession);

async function captureLiveCodingViewport(hideAfterCapture) {
  return captureLiveCodingScreenshot(hideAfterCapture, '');
}

async function captureLiveCodingScreenshot(hideAfterCapture, targetScreenshotId) {
  if (!targetScreenshotId && liveCodingScreenshotParts.length >= 20) {
    liveCodingStatus.textContent = 'The screenshot limit is 20. Reopen the panel and reconstruct this set.';
    return;
  }
  liveCodingStatus.textContent = `Capturing viewport ${liveCodingScreenshotParts.length + 1}…`;
  captureLiveCodingViewportBtn.disabled = true;
  let result;
  try {
    result = await window.overlayAPI.captureLiveCodingScreenshot(targetScreenshotId);
  } catch (error) {
    liveCodingStatus.textContent = `Screenshot capture failed: ${error.message || 'capture error.'}`;
    captureLiveCodingViewportBtn.disabled = false;
    return;
  }
  if (!result.ok) {
    liveCodingStatus.textContent = `Screenshot capture failed: ${result.error}`;
    captureLiveCodingViewportBtn.disabled = false;
    return;
  }
  const captured = {
    screenshotId: result.screenshotId,
    revision: result.revision,
    imagePart: result.imagePart,
    width: result.width,
    height: result.height,
  };
  const replacedIndex = liveCodingScreenshotParts.findIndex((item) => item.screenshotId === result.screenshotId);
  if (replacedIndex >= 0) liveCodingScreenshotParts.splice(replacedIndex, 1, captured);
  else liveCodingScreenshotParts.push(captured);
  if (targetScreenshotId) liveCodingRecaptureRequests = [];
  liveCodingScreenshotCount.textContent = liveCodingScreenshotParts.map((item) => `${item.screenshotId} r${item.revision}`).join(' · ');
  liveCodingRetakeTarget.replaceChildren(...liveCodingScreenshotParts.map((item) => {
    const option = document.createElement('option');
    option.value = item.screenshotId;
    option.textContent = `${item.screenshotId} (current r${item.revision})`;
    return option;
  }));
  liveCodingRetakeTarget.hidden = liveCodingScreenshotParts.length === 0;
  liveCodingRetakeBtn.hidden = liveCodingScreenshotParts.length === 0;
  liveCodingEndSessionBtn.hidden = false;
  liveCodingResult = null;
  liveCodingCopyBtn.hidden = true;
  liveCodingReview.hidden = true;
  reconstructLiveCodingScreenshotsBtn.disabled = false;
  liveCodingStatus.textContent = `Captured ${result.screenshotId} revision ${result.revision} (${result.width}×${result.height}). The full active window, including both panes, was saved temporarily.`;
  if (hideAfterCapture) {
    try {
      await window.overlayAPI.hideLiveCodingOverlay();
    } catch (error) {
      liveCodingStatus.textContent += ` The overlay could not hide automatically: ${error.message || 'hide error.'}`;
    }
  }
  captureLiveCodingViewportBtn.disabled = false;
}

async function beginScreenshotFallback() {
  try { await window.overlayAPI.setLiveCodingWindowMode('expanded'); } catch (_) { /* Keep the original bounds if expansion fails. */ }
  if (!liveCodingDialog.open) liveCodingDialog.showModal();
  try { await window.overlayAPI.endLiveCodingSession(); } catch (_) { /* Start a fresh capture session. */ }
  liveCodingWorkspace.classList.add('screenshot-mode');
  liveCodingShortcuts.hidden = false;
  liveCodingScreenshotMode = true;
  liveCodingScreenshotParts = [];
  liveCodingScreenshotReconstructionReady = false;
  liveCodingInstructions.value = '';
  liveCodingSource.value = '';
  liveCodingCompleteConfirmation.checked = false;
  liveCodingResult = null;
  liveCodingCaptureTruncated = false;
  startLiveCodingScreenshotsBtn.hidden = true;
  captureLiveCodingViewportBtn.hidden = false;
  liveCodingCompleteConfirmation.closest('label').hidden = true;
  liveCodingCaptureBtn.hidden = true;
  liveCodingGenerateBtn.hidden = true;
  reconstructLiveCodingScreenshotsBtn.disabled = true;
  liveCodingScreenshotCount.textContent = '0 screenshots';
  liveCodingRecaptureRequests = [];
  liveCodingRetakeTarget.replaceChildren();
  liveCodingRetakeTarget.hidden = true;
  liveCodingRetakeBtn.hidden = true;
  liveCodingEndSessionBtn.hidden = false;
  liveCodingStatus.textContent = 'Screenshot fallback started. Capturing the first view now…';
  await captureLiveCodingViewport(true);
}

startLiveCodingScreenshotsBtn.addEventListener('click', beginScreenshotFallback);
captureLiveCodingViewportBtn.addEventListener('click', () => {
  liveCodingScreenshotMode = true;
  liveCodingScreenshotReconstructionReady = false;
  liveCodingCompleteConfirmation.checked = false;
  liveCodingGenerateBtn.disabled = true;
  captureLiveCodingViewport(true);
});

liveCodingRetakeBtn.addEventListener('click', () => {
  const targetId = liveCodingRetakeTarget.value;
  if (!targetId) return;
  liveCodingScreenshotMode = true;
  liveCodingScreenshotReconstructionReady = false;
  liveCodingCompleteConfirmation.checked = false;
  liveCodingGenerateBtn.disabled = true;
  captureLiveCodingScreenshot(true, targetId);
});

async function endLiveCodingSession() {
  try {
    await window.overlayAPI.endLiveCodingSession();
    liveCodingScreenshotParts = [];
    liveCodingScreenshotMode = false;
    liveCodingWorkspace.classList.remove('screenshot-mode');
    liveCodingShortcuts.hidden = true;
    liveCodingScreenshotReconstructionReady = false;
    liveCodingRecaptureRequests = [];
    liveCodingResult = null;
    liveCodingInstructions.value = '';
    liveCodingSource.value = '';
    liveCodingCompleteConfirmation.checked = false;
    liveCodingReview.hidden = true;
    liveCodingCopyBtn.hidden = true;
    liveCodingGenerateBtn.disabled = true;
    liveCodingScreenshotCount.textContent = '0 screenshots';
    liveCodingRetakeTarget.replaceChildren();
    liveCodingRetakeTarget.hidden = true;
    liveCodingRetakeBtn.hidden = true;
    liveCodingEndSessionBtn.hidden = true;
    reconstructLiveCodingScreenshotsBtn.disabled = true;
    captureLiveCodingViewportBtn.hidden = true;
    startLiveCodingScreenshotsBtn.hidden = false;
    startLiveCodingScreenshotsBtn.disabled = false;
    liveCodingCompleteConfirmation.closest('label').hidden = false;
    liveCodingCaptureBtn.hidden = false;
    liveCodingGenerateBtn.hidden = false;
    if (liveCodingDialog.open) liveCodingDialog.close();
    await window.overlayAPI.setLiveCodingWindowMode('restore');
    liveCodingStatus.textContent = 'Live-coding session ended. Temporary screenshots were deleted.';
  } catch (error) {
    liveCodingStatus.textContent = `Could not end the session and delete its screenshots: ${error.message || 'cleanup error.'}`;
  }
}

liveCodingEndSessionBtn.addEventListener('click', endLiveCodingSession);

async function analyzeLiveCodingScreenshots() {
  if (liveCodingAnalyzing) return;
  if (!liveCodingScreenshotParts.length) {
    liveCodingStatus.textContent = 'No screenshots are available yet. Press Ctrl+I to capture the full active window.';
    return;
  }
  liveCodingAnalyzing = true;
  try { await window.overlayAPI.setLiveCodingWindowMode('expanded'); } catch (_) { /* Continue at the current overlay size. */ }
  if (!liveCodingDialog.open) liveCodingDialog.showModal();
  liveCodingWorkspace.classList.add('screenshot-mode');
  liveCodingShortcuts.hidden = false;
  reconstructLiveCodingScreenshotsBtn.disabled = true;
  captureLiveCodingViewportBtn.disabled = true;
  liveCodingStatus.textContent = `Gemini is reading both panes and solving from ${liveCodingScreenshotParts.length} active screenshot revision(s)…`;
  let result;
  try {
    result = await window.overlayAPI.reconstructLiveCodingScreenshots(liveCodingScreenshotParts);
  } catch (error) {
    liveCodingAnalyzing = false;
    liveCodingStatus.textContent = `Screenshot reconstruction failed: ${error.message || 'Gemini request error.'}`;
    reconstructLiveCodingScreenshotsBtn.disabled = false;
    captureLiveCodingViewportBtn.disabled = false;
    return;
  }
  captureLiveCodingViewportBtn.disabled = false;
  if (!result.ok) {
    liveCodingAnalyzing = false;
    liveCodingStatus.textContent = `Screenshot reconstruction failed: ${result.error}`;
    reconstructLiveCodingScreenshotsBtn.disabled = false;
    return;
  }

  liveCodingInstructions.value = result.instructions || '';
  liveCodingSource.value = result.sourceCode || '';
  liveCodingScreenshotReconstructionReady = result.status === 'ready';
  liveCodingCompleteConfirmation.checked = false;
  liveCodingGenerateBtn.disabled = true;
  liveCodingScreenshotMode = true;
  liveCodingRecaptureRequests = result.recaptureRequests || [];
  const requestedId = liveCodingRecaptureRequests.flatMap((request) => request.screenshotIds || [])
    .find((id) => liveCodingScreenshotParts.some((item) => item.screenshotId === id));
  if (requestedId) liveCodingRetakeTarget.value = requestedId;
  liveCodingResult = {
    code: result.solutionCode,
    changedLines: result.changedLines || [],
    assumedLines: result.assumedLines || [],
  };
  renderLiveCodingCode(liveCodingResult);
  document.getElementById('live-coding-summary').textContent = `${result.status === 'ready' ? 'Solution ready' : 'Provisional solution'} — ${result.summary || 'Full best-effort code from the current captures'}`;
  const recaptures = liveCodingRecaptureRequests.map((request) => {
    const ids = (request.screenshotIds || []).join(', ') || 'unknown screenshot';
    const resultRange = request.solutionLineRange || request.lineRange;
    const ranges = [
      resultRange ? `result lines ${resultRange.start}–${resultRange.end}` : '',
      request.visibleEditorLineRange ? `visible editor lines ${request.visibleEditorLineRange.start}–${request.visibleEditorLineRange.end}` : '',
    ].filter(Boolean).join('; ');
    const location = [ranges, request.anchor ? `near “${request.anchor}”` : ''].filter(Boolean).join(', ') || 'the unclear area';
    return `Recapture ${ids} · ${request.pane || 'code'} · ${location}: ${request.issue || 'unclear text'}\n${request.recaptureSteps || 'Scroll the requested area into view, then retake the listed screenshot ID.'}`;
  });
  const validation = result.validation || {};
  const validationNote = validation.method === 'python_execution'
    ? `Validation: Gemini returned Python execution results. ${validation.tests?.map((test) => `${test.result}: input ${test.input}; expected ${test.expected}; actual ${test.actual}`).join('; ') || 'See execution output below.'}\n${(validation.executionOutputs || []).map((item) => `${item.outcome}: ${item.output}`).join('\n')}`
    : `Validation: ${validation.method === 'static_review' ? 'static reasoning only' : 'not executed'}; hidden test cases are not verified.`;
  const notes = [
    ...((result.assumptions || []).map((item) => `Assumption: ${item}`)),
    ...((validation.limitations || []).map((item) => `Validation limit: ${item}`)),
    validationNote,
    ...recaptures,
  ];
  document.getElementById('live-coding-notes').textContent = notes.join('\n\n');
  liveCodingReview.hidden = false;
  liveCodingCopyBtn.hidden = false;
  liveCodingStatus.textContent = result.status === 'ready'
    ? `Complete best-effort solution generated from ${liveCodingScreenshotParts.length} active screenshot(s). ${liveCodingRecaptureRequests.length ? 'Review the targeted recapture requests.' : ''}`
    : `Provisional full-code solution generated from current screenshots. ${liveCodingRecaptureRequests.length} targeted recapture request(s); select a cited ID to replace it and reanalyze all active screenshots.`;
  reconstructLiveCodingScreenshotsBtn.disabled = false;
  liveCodingAnalyzing = false;
}

reconstructLiveCodingScreenshotsBtn.addEventListener('click', analyzeLiveCodingScreenshots);

liveCodingGenerateBtn.addEventListener('click', async () => {
  liveCodingGenerateBtn.disabled = true;
  liveCodingCaptureBtn.disabled = true;
  liveCodingStatus.textContent = 'Gemini is analyzing the instruction and preparing a minimal patch…';
  liveCodingReview.hidden = true;
  liveCodingCopyBtn.hidden = true;
  let result;
  try {
    result = await window.overlayAPI.generateLiveCodingPatch({
      instructions: liveCodingInstructions.value,
      code: liveCodingSource.value,
      screenshots: liveCodingScreenshotParts,
    });
  } catch (error) {
    liveCodingStatus.textContent = `Patch failed safely; the captured source was not changed. ${error.message || 'Gemini request failed.'}`;
    liveCodingCaptureBtn.disabled = false;
    liveCodingGenerateBtn.disabled = false;
    return;
  }
  liveCodingCaptureBtn.disabled = false;
  liveCodingGenerateBtn.disabled = false;

  if (!result.ok) {
    liveCodingStatus.textContent = `Patch failed safely; the captured source was not changed. ${result.error}`;
    return;
  }
  if (result.needsMoreSource) {
    const concerns = [...(result.sourceConcerns || []), ...(result.assumptions || [])];
    liveCodingStatus.textContent = `No patch was applied. Gemini needs more source: ${result.summary}`;
    document.getElementById('live-coding-summary').textContent = 'Capture more source and retry';
    document.getElementById('live-coding-notes').textContent = concerns.join('\n');
    liveCodingReview.hidden = false;
    return;
  }

  liveCodingResult = result;
  renderLiveCodingCode(result);
  document.getElementById('live-coding-summary').textContent = result.summary;
  const recaptures = (result.recaptureRequests || []).map((request) => {
    const ids = (request.screenshotIds || []).join(', ') || 'unknown screenshot';
    const resultRange = request.solutionLineRange || request.lineRange;
    const ranges = [
      resultRange ? `result lines ${resultRange.start}–${resultRange.end}` : '',
      request.visibleEditorLineRange ? `visible editor lines ${request.visibleEditorLineRange.start}–${request.visibleEditorLineRange.end}` : '',
    ].filter(Boolean).join('; ');
    const location = [ranges, request.anchor ? `near “${request.anchor}”` : ''].filter(Boolean).join(', ') || 'the unclear area';
    return `Recapture ${ids} · ${request.pane || 'code'} · ${location}: ${request.issue || 'unclear text'}\n${request.recaptureSteps || 'Scroll the requested area into view and retake the listed screenshot ID.'}`;
  });
  const validation = result.validation || {};
  const validationNote = validation.method === 'python_execution'
    ? `Validation: Gemini returned Python execution results. ${validation.tests?.map((test) => `${test.result}: input ${test.input}; expected ${test.expected}; actual ${test.actual}`).join('; ') || 'See execution output below.'}\n${(validation.executionOutputs || []).map((item) => `${item.outcome}: ${item.output}`).join('\n')}`
    : `Validation: ${validation.method === 'static_review' ? 'static reasoning only' : 'not executed'}; hidden test cases are not verified.`;
  const notes = [...(result.sourceConcerns || []), ...(result.assumptions || []).map((item) => `Assumption: ${item}`), ...recaptures, validationNote];
  document.getElementById('live-coding-notes').textContent = notes.join('\n');
  liveCodingReview.hidden = false;
  liveCodingCopyBtn.hidden = false;
  liveCodingCopyBtn.hidden = false;
  liveCodingStatus.textContent = `${result.status === 'provisional' ? 'Provisional patch' : 'Patch'} applied to the captured text. ${result.changedLines.length} changed line(s), ${result.assumedLines.length} inferred line(s). Validation: ${result.validation?.method === 'python_execution' ? 'Gemini Python execution' : 'not executed'}; hidden tests remain unverified.`;
});

liveCodingCopyBtn.addEventListener('click', async () => {
  if (!liveCodingResult) return;
  try {
    const result = await window.overlayAPI.copyLiveCodingCode(liveCodingResult.code);
    liveCodingStatus.textContent = result.ok ? 'Full assembled code copied to clipboard.' : 'Could not copy the assembled code.';
  } catch (error) {
    liveCodingStatus.textContent = `Could not copy the assembled code: ${error.message || 'clipboard error.'}`;
  }
});

// --- Voice input (push-to-toggle: press to start, press again to stop+send) ---
// True "hold to talk" isn't reliable with global OS hotkeys (no keyup event
// available), so this uses toggle semantics instead — press once to start
// recording, press again (same hotkey or button) to stop and send.

const voiceBtn = document.getElementById('voice-btn');
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start();
    isRecording = true;
    voiceBtn.textContent = '⏹ Stop';
    voiceBtn.classList.add('recording');
  } catch (err) {
    appendEntry('System', 'Could not access microphone: ' + err.message, true);
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    isRecording = false;
    voiceBtn.textContent = '🎤 Talk';
    voiceBtn.classList.remove('recording');
  }
}

async function handleRecordingStop() {
  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const blob = new Blob(audioChunks, { type: mimeType });

  if (blob.size === 0) return; // nothing recorded, don't bother sending

  appendEntry('You', '🎤 (voice message)');
  voiceBtn.disabled = true;

const arrayBuffer = await blob.arrayBuffer();
const bytes = new Uint8Array(arrayBuffer);

const result = await window.overlayAPI.saveScreenRecording(
  bytes,
  mimeType
);

  if (result.ok) {
    appendEntry('Gemini', result.text);
  } else {
    appendEntry(
      'Gemini',
      result.error +
        ' (if this keeps happening, the audio format the browser recorded — ' +
        mimeType +
        ' — may not be one Gemini accepts; let me know and we can adjust it)',
      true
    );
  }
  voiceBtn.disabled = false;
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

voiceBtn.addEventListener('click', toggleRecording);
window.overlayAPI.onTriggerToggleVoice(toggleRecording);
// --- Screen recording (hotkey only, no UI button) ---
// --- Screen recording (hotkey only, no UI button) ---
// --- Screen recording ---
// --- Screen recording (hotkey only, no UI button) ---
let isScreenRecording = false;
let screenRecorder = null;
let screenChunks = [];

async function toggleScreenRecording() {
  if (isScreenRecording) {
    stopScreenRecording();
    return;
  }

  await startScreenRecording();
}

async function startScreenRecording() {
  try {
    if (!navigator.mediaDevices) {
      throw new Error(
        'MediaDevices API is unavailable in this Electron renderer.'
      );
    }

    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error(
        'getDisplayMedia() is unavailable in this Electron version/context.'
      );
    }

    appendEntry('System', '🎥 Starting screen capture…');

    /*
     * IMPORTANT:
     * The overlay's capture exclusion is controlled by the native
     * SetWindowDisplayAffinity implementation in index.js.
     *
     * This recording code does NOT modify that behavior.
     *
     * audio:true asks Electron for the loopback/system-audio track.
     * index.js supplies that track through setDisplayMediaRequestHandler().
     */
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 30,
      },
      audio: true,
    });

    if (!displayStream || displayStream.getVideoTracks().length === 0) {
      throw new Error('No video track was returned by Windows capture.');
    }

    /*
     * Build the recording stream.
     *
     * At this stage we use the audio track supplied by Electron.
     * We do NOT start the separate systemAudioRecorder below.
     */
    const recordingTracks = [
      ...displayStream.getVideoTracks(),
      ...displayStream.getAudioTracks(),
    ];

    const recordingStream = new MediaStream(recordingTracks);

    console.log(
      '[screen-recording] video tracks:',
      recordingStream.getVideoTracks().length
    );

    console.log(
      '[screen-recording] audio tracks:',
      recordingStream.getAudioTracks().length
    );

    if (recordingStream.getAudioTracks().length === 0) {
      appendEntry(
        'System',
        '⚠ Screen capture started, but Windows did not provide a system-audio track.'
      );
    }

    screenChunks = [];

    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];

    const supportedMimeType = mimeTypes.find((type) =>
      MediaRecorder.isTypeSupported(type)
    );

    if (!supportedMimeType) {
      recordingStream.getTracks().forEach((track) => track.stop());

      throw new Error(
        'No supported WebM video/audio codec was found.'
      );
    }

    console.log(
      '[screen-recording] Using MIME type:',
      supportedMimeType
    );

    screenRecorder = new MediaRecorder(recordingStream, {
      mimeType: supportedMimeType,
    });

    screenRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        screenChunks.push(event.data);
      }
    };

    screenRecorder.onerror = (event) => {
      console.error(
        '[screen-recording] MediaRecorder error:',
        event.error
      );

      appendEntry(
        'System',
        '❌ Screen recorder error: ' +
          (event.error?.message || 'Unknown recorder error'),
        true
      );
    };

    screenRecorder.onstop = async () => {
      try {
        const mimeType =
          screenRecorder.mimeType || supportedMimeType;

        const blob = new Blob(screenChunks, {
          type: mimeType,
        });

        if (blob.size === 0) {
          throw new Error(
            'Recording produced an empty video file.'
          );
        }

        appendEntry(
          'System',
          '💾 Saving recording…'
        );

        const arrayBuffer = await blob.arrayBuffer();

        /*
         * Preload exposes saveScreenRecording(), which sends
         * this to ipcHandlers.js -> save-screen-recording.
         */
        const result =
          await window.overlayAPI.saveScreenRecording(
            arrayBuffer,
            mimeType
          );

        if (!result.ok) {
          throw new Error(result.error);
        }

        appendEntry(
          'System',
          `🎥 Recording saved: ${result.filePath}`
        );

      } catch (err) {
        console.error(
          '[screen-recording] Finalization failed:',
          err
        );

        appendEntry(
          'System',
          '❌ Failed to save recording: ' +
            err.message,
          true
        );

      } finally {
        screenChunks = [];
        screenRecorder = null;
      }
    };

    /*
     * If the user stops Windows screen sharing,
     * stop our recorder too.
     */
    const videoTrack =
      recordingStream.getVideoTracks()[0];

    videoTrack.addEventListener('ended', () => {
      if (isScreenRecording) {
        stopScreenRecording();
      }
    });

    /*
     * Also stop recording if the audio track unexpectedly ends.
     */
    const audioTrack =
      recordingStream.getAudioTracks()[0];

    if (audioTrack) {
      audioTrack.addEventListener('ended', () => {
        console.warn(
          '[screen-recording] System audio track ended.'
        );
      });
    }

    screenRecorder.start(1000);

    isScreenRecording = true;

    appendEntry(
      'System',
      '🎥 Screen recording started'
    );

  } catch (err) {
    console.error(
      '[screen-recording] Start failed:',
      err
    );

    isScreenRecording = false;
    screenRecorder = null;
    screenChunks = [];

    appendEntry(
      'System',
      '❌ Screen recording failed: ' +
        (err.message || err),
      true
    );
  }
}

function stopScreenRecording() {
  if (!screenRecorder || !isScreenRecording) {
    return;
  }

  appendEntry(
    'System',
    '⏹ Stopping screen recording…'
  );

  isScreenRecording = false;

  /*
   * IMPORTANT:
   * Do not immediately stop the tracks before MediaRecorder
   * finishes its final dataavailable/onstop sequence.
   */
  if (screenRecorder.state !== 'inactive') {
    screenRecorder.stop();
  }

  const stream = screenRecorder.stream;

  /*
   * Stop the underlying tracks after requesting recorder.stop().
   */
  if (stream) {
    setTimeout(() => {
      stream.getTracks().forEach((track) => {
        if (track.readyState !== 'ended') {
          track.stop();
        }
      });
    }, 100);
  }
}

window.overlayAPI.onToggleScreenRecording(
  toggleScreenRecording
);

// --- Clear conversation ---

document.getElementById('clear-btn').addEventListener('click', async () => {
  await window.overlayAPI.clearConversation();
  clearChatLog();
});

// --- System audio capture (postmortems/conference talks via speakers) ---
// UNTESTED / HIGHEST-UNCERTAINTY PIECE: Electron's desktop-audio-loopback
// capture uses a legacy Chromium constraint syntax (`mandatory` +
// `chromeMediaSource`) that is genuinely inconsistent across Electron
// versions and Windows audio configurations. If this throws or the audio
// track comes back empty/silent, that's the first thing to investigate —
// see chat error message for specifics when it happens.

const recordAudioBtn = document.getElementById('record-audio-btn');
let systemAudioRecorder = null;
let systemAudioChunks = [];
let isCapturingSystemAudio = false;

async function startSystemAudioCapture() {
  try {
    const sourceId = await window.overlayAPI.getDesktopSourceId();
    if (!sourceId) {
      appendEntry('System', 'Could not get a desktop capture source — no screen source available.', true);
      return;
    }

    // Legacy Chromium constraint syntax — Electron still supports this for
    // desktop audio/video capture even though standard getUserMedia typing
    // doesn't document it. video is requested because some Chromium/Electron
    // versions only enable the loopback-audio code path when paired with a
    // video request — we discard the video track immediately below.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      },
    });

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      appendEntry(
        'System',
        'Desktop capture succeeded but returned no audio track — system audio loopback ' +
          'may not be supported on this Windows configuration. Let me know and we can dig into it.',
        true
      );
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // Discard video immediately — we only want audio, no need to burn
    // resources capturing/holding onto video frames.
    stream.getVideoTracks().forEach((t) => t.stop());

    const audioOnlyStream = new MediaStream(audioTracks);
    systemAudioChunks = [];
    systemAudioRecorder = new MediaRecorder(audioOnlyStream);
    systemAudioRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) systemAudioChunks.push(e.data);
    };
    systemAudioRecorder.onstop = handleSystemAudioStop;
    systemAudioRecorder.start();
    isCapturingSystemAudio = true;
    recordAudioBtn.textContent = '⏹ Stop Capture';
    recordAudioBtn.classList.add('recording');
    appendEntry('System', '🔊 Capturing system audio — play the recording now. Click again when it ends.');
  } catch (err) {
    appendEntry(
      'System',
      'System audio capture failed: ' + err.message + ' — this is the least-tested part of the app, see code comments in renderer.js.',
      true
    );
  }
}

function stopSystemAudioCapture() {
  if (systemAudioRecorder && isCapturingSystemAudio) {
    systemAudioRecorder.stop();
    systemAudioRecorder.stream.getTracks().forEach((t) => t.stop());
    isCapturingSystemAudio = false;
    recordAudioBtn.textContent = '🔊 Capture Recording';
    recordAudioBtn.classList.remove('recording');
  }
}

async function handleSystemAudioStop() {
  const mimeType = systemAudioRecorder.mimeType || 'audio/webm';
  const blob = new Blob(systemAudioChunks, { type: mimeType });

  if (blob.size === 0) {
    appendEntry('System', 'No audio was captured — nothing to summarize.', true);
    return;
  }

  // FIXED: window.prompt() was blocking here and likely rendering behind
  // the always-on-top overlay, invisible — meaning execution silently
  // stalled waiting for input the user never saw. Using an inline field
  // instead, which is always visible and never blocks.
  const labelInput = document.getElementById('recording-label-input');
  const label = (labelInput.value || '').trim() || `Recording ${new Date().toLocaleString()}`;
  labelInput.value = '';

  // Immediate feedback the moment recording stops, BEFORE the network call
  // — previously nothing appeared until the (possibly slow) Gemini request
  // finished, which looked identical to "nothing happened."
  appendEntry('You', `🔊 Recording stopped ("${label}") — sending for summarization…`);
  recordAudioBtn.disabled = true;

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  const result = await window.overlayAPI.summarizeRecording(base64, mimeType, label);

  if (result.ok) {
    appendEntry('Gemini', result.text);
    appendEntry('System', `Saved to local lessons store (id: ${result.savedAs}). This is interim storage — no real-time retrieval yet.`);
  } else {
    appendEntry('Gemini', result.error, true);
  }
  recordAudioBtn.disabled = false;
}

function toggleSystemAudioCapture() {
  if (isCapturingSystemAudio) stopSystemAudioCapture();
  else startSystemAudioCapture();
}

recordAudioBtn.addEventListener('click', toggleSystemAudioCapture);

// --- Lessons viewer ---

document.getElementById('view-lessons-btn').addEventListener('click', async () => {
  const result = await window.overlayAPI.getAllLessons();
  if (!result.ok) {
    appendEntry('System', 'Could not load lessons: ' + result.error, true);
    return;
  }
  if (result.lessons.length === 0) {
    appendEntry('System', 'No lessons saved yet — use "Capture Recording" on a postmortem/talk first.');
    return;
  }
  const listText = result.lessons
    .map((l, i) => `${i + 1}. "${l.label}" — saved ${new Date(l.savedAt).toLocaleString()}`)
    .join('\n');
  appendEntry('System', `${result.lessons.length} saved lesson(s):\n${listText}\n\n(Click a specific one to review — not built yet; for now check data/lessons.json directly.)`);
});
