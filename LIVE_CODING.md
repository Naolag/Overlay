# Live coding mode

Live coding is an isolated workflow started with `Ctrl+I` on Windows. It does not reuse the interview-answer prompt, shared chat history, job-session context, or screenshot-answer handlers.

## Capture and patch flow

1. The hotkey records the last external window handle and shows the existing overlay panel without activating it, so the target editor keeps focus during capture.
2. A Windows UI Automation reader requests text from accessible controls using read-only Text and Value patterns. It does not click, focus, scroll, type, select text, or read/write the clipboard.
3. Text controls are grouped by horizontal position: left-side text is treated as task instructions and right-side text as editor source. The panel shows both captured inputs and requires review because off-screen coverage depends on the editor's accessibility provider.
4. If accessibility capture fails or cannot expose the editor text, screenshot fallback captures the active window at higher resolution. Start fallback once, scroll the code by roughly 60–70% of the viewport so captures overlap, and press `Ctrl+I` for each view. The same overlay hides after each capture so it does not cover the challenge. Press `Ctrl+Shift+Space` to reopen the panel, then ask Gemini to reconstruct the continuous instruction and source text. Gemini must request more screenshots when it cannot confirm top-to-bottom coverage or an overlap sequence.
5. Gemini returns JSON containing minimal exact-match edits. Every match must occur exactly once in the captured or reconstructed source; overlapping or ambiguous edits are rejected without applying any changes.
6. The app assembles the full result from the original text and accepted edits. Changed lines render blue and explicitly assumed replacement lines render red. The result can be copied from the panel.

No code is executed and this workflow does not edit the interview provider's editor. It only creates an assembled result in the overlay.

## Completeness limitation

UI Automation can expose only the visible/accessibility page for some editors. The capture preview and status disclose that limitation. Screenshot fallback requires manual scrolling and overlap; it also cannot recover lines that are never captured or unreadable. Validate the target editor in a practice environment before relying on the result. Both routes require the user to review the assembled text before generating a patch.

`Ctrl+I` registration is logged at startup. Electron does not guarantee that an OS-level global shortcut can be registered if another application already owns it.

