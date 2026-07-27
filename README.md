# On-Call Overlay Agent — Day 1 Prototype

Capture-excluded overlay shell. This is the foundation everything else builds on —
get this rock-solid before moving to Day 2.

## Folder structure

Structured now for the full 9-day MVP scope (not guessing beyond that —
post-MVP features like the Confluence connector get their own structure
when we actually reach them):

```
main/
  index.js              app entry, window lifecycle
  hotkeys.js            toggle + panic-hide global shortcuts
  ipcHandlers.js         central registry of all ipcMain.handle calls
  native/
    displayAffinity.js   the fragile Win32/koffi HWND code, isolated on
                         purpose so it's easy to find, test, or swap for
                         a C# P/Invoke helper without touching anything else
  captureSelfTest.js     (Day 5) watermark self-test loop — not yet created
  fallbackDisplay.js     (Day 6) second-display/virtual-display logic — not yet created
preload/
  preload.js             contextBridge — the ONLY bridge between renderer and OS
renderer/
  index.html
  renderer.js
  components/            (empty — chat box, notes editor land here as the UI grows)
services/
  geminiClient.js        (Day 2) — not yet created
  auditLog.js            (Day 7) — not yet created
  notesStore.js          (Day 7) — not yet created
data/                    gitignored, created at runtime by auditLog/notesStore
```

## Requirements

- Windows 10 version 2004 (May 2020 Update) or later — `WDA_EXCLUDEFROMCAPTURE` doesn't exist on older builds
- Node.js 18+ and npm

## Setup

```bash
cd oncall-overlay-agent
npm install
npm start
```

You should see a dark panel in the top-left of your screen with a status line.

## What "done" looks like today

- Panel shows **"✓ Excluded from capture"**
- `Ctrl+Shift+Space` toggles the overlay visible/hidden
- `Ctrl+Shift+Esc` force-hides it (your manual backstop, works even if everything else is broken)

## Troubleshooting the HWND pointer call

This is the one part of Day 1 I couldn't verify myself — I don't have a Windows
machine in my sandbox, only Linux, so I can't run Win32 FFI calls to confirm this
exact syntax against your installed `koffi` version.

The concept is solid (this is a documented, standard pattern for calling Win32 APIs
from Electron via FFI), but the exact way to convert the `Buffer` from
`getNativeWindowHandle()` into a pointer koffi accepts can vary by koffi version.
In `main.js`, look at `applyCaptureExclusion()`:

```js
const hwndBuffer = overlayWindow.getNativeWindowHandle();
const hwndValue = hwndBuffer.readBigUInt64LE(0);
const hwndPtr = koffi.address(hwndValue, 'void*'); // <-- this line
```

**If you see an error here or `SetWindowDisplayAffinity` returns `false`:**

1. Run `npm ls koffi` to check your installed version, then check koffi's docs
   for that version — the pointer-construction API (`koffi.address`,
   `koffi.as`, or passing the raw `Buffer` directly) has changed between
   versions.
2. As a quick sanity check, try passing `hwndBuffer` directly instead of
   converting it — some koffi versions accept the raw handle buffer as the
   pointer argument without manual conversion:
   ```js
   const ok = SetWindowDisplayAffinity(hwndBuffer, WDA_EXCLUDEFROMCAPTURE);
   ```
3. If FFI conversion keeps fighting you, the reliable fallback is a tiny
   compiled C# console helper (a few lines calling `SetWindowDisplayAffinity`
   via P/Invoke) that Electron shells out to via `child_process` — more moving
   parts, but zero FFI pointer ambiguity. Say the word and I'll scaffold that
   version instead.

**Don't skip verifying this actually returns `true` before Day 2.** Everything
downstream assumes this call works.

## Day 2 setup — Gemini API key

1. Get a free key at https://aistudio.google.com/apikey (no credit card needed)
2. Copy `.env.example` to `.env`
3. Paste your key into `.env` as `GEMINI_API_KEY=...`
4. `npm install` (adds `dotenv`)
5. `npm start`

The default model is `gemini-flash-latest` — an alias Google keeps pointed at
their current fastest free-tier-eligible Flash model, so you don't have to
hand-edit the model string every time Google ships a new version. If you want
to pin a specific version instead, set `GEMINI_MODEL` in `.env` (check
https://ai.google.dev/gemini-api/docs/models for current options — this space
moves fast, models get renamed/retired every few months).

## Day 2 exit checklist

- [ ] Typing a question and hitting Enter (or clicking Send) shows your
      message, then a Gemini response, in the chat log
- [ ] Shift+Enter adds a newline instead of sending
- [ ] Removing/breaking the API key in `.env` produces a readable error in
      the chat log, not a crash
- [ ] The capture-exclusion status line from Day 1 still updates correctly
      alongside the new chat UI

## Day 1 exit checklist

- [ ] `npm start` launches the overlay without errors
- [ ] Status line reads "✓ Excluded from capture"
- [ ] Ctrl+Shift+Space toggles visibility
- [ ] Ctrl+Shift+Esc hides it
- [ ] (Stretch, sets up Day 3) Start a Windows screen recording via `Win+G`
      (Xbox Game Bar) with the overlay visible, stop it, and check the
      recording — overlay should not appear. This is a cheap first look
      ahead of the full Day 3 test matrix.

## Next: Day 2

Gemini Flash API wired into a chat box inside this same panel.
