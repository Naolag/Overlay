# Live coding mode

Live coding is an isolated workflow started with `Ctrl+I` on Windows. It does not reuse the interview-answer prompt, shared chat history, job-session context, or screenshot-answer handlers.

## Capture and patch flow

1. The hotkey records the last external window handle and shows the live-coding panel without activating it, so the target editor keeps focus during capture.
2. A Windows UI Automation reader requests text from accessible controls using read-only Text and Value patterns. It does not click, focus, scroll, type, select text, or read/write the clipboard.
3. Text controls are grouped by their horizontal position: left-side text is treated as task instructions and right-side text as editor source. The panel shows both captured inputs and warns that full off-screen coverage is not established until this specific editor is validated.
4. Gemini returns JSON containing minimal exact-match edits. Every match must occur exactly once in the captured source; overlapping or ambiguous edits are rejected without applying any changes.
5. The app assembles the full result from the original captured text and accepted edits. Changed lines render blue and explicitly assumed replacement lines render red. The result can be copied from the panel.

No code is executed and this workflow does not edit the interview provider's editor. It only creates an assembled result in the overlay.

## Completeness limitation

UI Automation can expose only the visible/accessibility page for some editors. This first implementation cannot prove that an accessibility response includes every off-screen source line. The capture preview and status disclose that limitation. Validate the target editor in a practice environment before relying on the result. If the editor does not expose the full text, this workflow stops when no code text is available; a future screenshot-scroll fallback would need an explicit user-controlled capture process.

`Ctrl+I` registration is logged at startup. Electron does not guarantee that an OS-level global shortcut can be registered if another application already owns it.

