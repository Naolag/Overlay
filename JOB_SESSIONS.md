# Job interview sessions

Job sessions are optional. The screen-answer path still runs when no session is active.

## Start and finish

1. Select **Start job session**.
2. Enter the job name, full job description or requirements, and required skills.
3. Choose whether to add compact job context and same-request question transcription.
4. Wait for preparation to finish before beginning the interview. Context is generated once and checked against its token budget before the live interview.
5. Use the existing **Ctrl+Shift+R** shortcut or **Read Screen** button for each question.
6. Select **End session** when finished.

Session files are saved under `Documents/Overlay Job Sessions/<timestamp>-<job-name>/`:

- `job-session.json` contains the original job details and skills, prompt/model information, and numbered question/answer records.
- `context.txt` contains the compact reusable job context. It is empty when context is disabled or the budget is zero.
- `screenshots/` contains the JPEG for each captured question.

Each record stores the screenshot path, optional transcript, answer (null when Gemini returns no answer), status, request latency, input-token count, model version, and any error. Files are updated in the background. If a local write fails, the interview continues and the session bar offers a save retry.

## Context budget

The initial full-request input ceiling is 2,304 tokens. Before the interview, the app counts the current primary prompt and shared instruction, reserves 1,548 tokens for the 1280×900 screenshot and 256 tokens of margin, then gives the remaining capacity to the job context, capped at 250 tokens:

```text
context limit = min(250, max(0, 2304 - prompt/system tokens - 1548 - 256))
```

The screenshot allowance is an initial estimate. Gemini's returned input-token metadata is saved with each recorded answer so future measurements can improve that estimate. Context compaction and token validation happen before the interview; no token-count request is added to the live screenshot path.

## Optional question transcription

When enabled, the same Gemini response includes `QUESTION:` and `ANSWER:` sections. The app stores the transcript and displays only the answer section. If it cannot parse those sections, it shows a retryable error and records the failed item; the screenshot remains saved. No separate transcription request is made.

Both context and transcription can be turned off for a session to compare their effect on response time and answer quality.
