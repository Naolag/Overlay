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