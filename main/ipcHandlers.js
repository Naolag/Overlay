const { ipcMain, desktopCapturer } = require('electron');
const geminiClient = require('../services/geminiClient');
const conversationState = require('./conversationState');
const { captureScreenshotPart } = require('./screenCapture');
const lessonsStore = require('./lessonsStore');
const cv_prompt=require('../cv');
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