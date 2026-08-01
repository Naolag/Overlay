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
  readScreenBtn.disabled = false;
}

readScreenBtn.addEventListener('click', handleReadScreen);
window.overlayAPI.onTriggerReadScreen(handleReadScreen);

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
  const base64 = arrayBufferToBase64(arrayBuffer);

  const result = await window.overlayAPI.sendVoiceQuery(base64, mimeType);

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

// --- Clear conversation ---

document.getElementById('clear-btn').addEventListener('click', async () => {
  await window.overlayAPI.clearConversation();
  clearChatLog();
});