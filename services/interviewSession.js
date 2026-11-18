const fs = require('fs');
const path = require('path');

let activeSession = null;
let lastSession = null;

function safeName(value) {
  const normalized = String(value || 'job')
    .normalize('NFKD')
    .replace(/[^\w\- ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return normalized || 'job';
}

async function writeState(session, screenshot) {
    if (screenshot) {
      await fs.promises.writeFile(
        path.join(session.directory, screenshot.relativePath),
        screenshot.buffer
      );
    }

    const filePath = path.join(session.directory, 'job-session.json');
    const temporaryPath = `${filePath}.tmp`;
    await fs.promises.writeFile(
      temporaryPath,
      JSON.stringify(session.data, null, 2),
      'utf8'
    );
    await fs.promises.rename(temporaryPath, filePath);
}

function enqueueWrite(session, screenshot) {
  const operation = () => writeState(session, screenshot);
  const writePromise = session.writeQueue.catch(() => {}).then(operation);
  session.writeQueue = writePromise.catch((err) => {
    session.failedOperations.push(operation);
    throw err;
  });
  return writePromise;
}

async function startSession({ documentsPath, jobName, jobDescription, requiredSkills, options, primaryPrompt, model }) {
  if (activeSession) {
    throw new Error('A job session is already active. End it before starting another.');
  }

  const startedAt = new Date();
  const directory = path.join(
    documentsPath,
    'Overlay Job Sessions',
    `${startedAt.toISOString().replace(/[:.]/g, '-')}-${safeName(jobName)}`
  );
  const screenshotsDirectory = path.join(directory, 'screenshots');
  await fs.promises.mkdir(screenshotsDirectory, { recursive: true });

  activeSession = {
    directory,
    writeQueue: Promise.resolve(),
    failedOperations: [],
    nextNumber: 1,
    options: {
      useContext: Boolean(options?.useContext),
      transcribeQuestion: Boolean(options?.transcribeQuestion),
    },
    context: '',
    data: {
      schemaVersion: 1,
      jobName: String(jobName || '').trim(),
      jobDescription: String(jobDescription || ''),
      requiredSkills: String(requiredSkills || ''),
      primaryPrompt: String(primaryPrompt || ''),
      promptVersion: 'baseline-v1',
      model: String(model || 'gemini-flash-latest'),
      startedAt: startedAt.toISOString(),
      endedAt: null,
      options: {
        useContext: Boolean(options?.useContext),
        transcribeQuestion: Boolean(options?.transcribeQuestion),
      },
      context: {
        file: 'context.txt',
        tokenLimit: null,
        tokenCount: null,
      },
      questions: [],
    },
  };
  lastSession = activeSession;

  try {
    await fs.promises.writeFile(path.join(directory, 'context.txt'), '', 'utf8');
    await enqueueWrite(activeSession);
  } catch (err) {
    activeSession = null;
    throw err;
  }
  return getStatus();
}

async function setContext({ text, tokenLimit, tokenCount }) {
  if (!activeSession) throw new Error('No job session is active.');
  const compactedContext = String(text || '').trim();
  const contextMetadata = {
    file: 'context.txt',
    tokenLimit: Number.isFinite(tokenLimit) ? tokenLimit : 0,
    tokenCount: Number.isFinite(tokenCount) ? tokenCount : 0,
  };
  await fs.promises.writeFile(
    path.join(activeSession.directory, 'context.txt'),
    compactedContext,
    'utf8'
  );
  activeSession.context = compactedContext;
  activeSession.data.context = contextMetadata;
  await enqueueWrite(activeSession);
  return getStatus();
}

function getRequestContext() {
  if (!activeSession || !activeSession.options.useContext) return '';
  return activeSession.context;
}

function shouldTranscribeQuestion() {
  return Boolean(activeSession?.options.transcribeQuestion);
}

function beginQuestion(screenshotBase64) {
  if (!activeSession) return null;

  const session = activeSession;
  const number = session.nextNumber++;
  const fileName = `${String(number).padStart(3, '0')}.jpg`;
  const relativePath = path.join('screenshots', fileName);
  const entry = {
    number,
    capturedAt: new Date().toISOString(),
    screenshot: relativePath.replace(/\\/g, '/'),
    question: null,
    answer: null,
    status: 'pending',
    error: null,
    latencyMs: null,
    inputTokens: null,
    modelVersion: null,
  };
  session.data.questions.push(entry);
  const writePromise = new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const screenshotBuffer = Buffer.from(screenshotBase64, 'base64');
        enqueueWrite(session, {
          relativePath,
          buffer: screenshotBuffer,
        }).then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  });
  return { number, writePromise, session };
}

function finishQuestion(handle, { question, answer, status, error, latencyMs, inputTokens, modelVersion }) {
  const session = handle?.session;
  const number = handle?.number;
  if (!session || !number) return Promise.resolve();
  const entry = session.data.questions.find((item) => item.number === number);
  if (!entry) return Promise.resolve();

  entry.question = question ? String(question).trim() : null;
  entry.answer = answer == null ? null : String(answer);
  entry.status = status || (answer == null ? 'no-answer' : 'answered');
  entry.error = error ? String(error) : null;
  entry.latencyMs = Number.isFinite(latencyMs) ? latencyMs : null;
  entry.inputTokens = Number.isFinite(inputTokens) ? inputTokens : null;
  entry.modelVersion = modelVersion ? String(modelVersion) : null;
  return enqueueWrite(session);
}

async function endSession() {
  if (!activeSession) return { active: false };
  const session = activeSession;
  session.data.endedAt = new Date().toISOString();
  await enqueueWrite(session);
  await session.writeQueue;
  activeSession = null;
  return { active: false, directory: session.directory };
}

async function retryPendingWrites() {
  const session = activeSession || lastSession;
  if (!session) throw new Error('No job session is available to retry.');
  if (!session.failedOperations.length) return { ok: true, pending: 0 };

  const pending = session.failedOperations.splice(0);
  const retryPromise = session.writeQueue.catch(() => {}).then(async () => {
    for (let index = 0; index < pending.length; index++) {
      try {
        await pending[index]();
      } catch (err) {
        session.failedOperations.push(...pending.slice(index));
        throw err;
      }
    }
  });
  session.writeQueue = retryPromise;
  await retryPromise;
  return { ok: true, pending: session.failedOperations.length };
}

function getStatus() {
  if (!activeSession) return { active: false };
  return {
    active: true,
    jobName: activeSession.data.jobName,
    directory: activeSession.directory,
    questionCount: activeSession.data.questions.length,
    options: { ...activeSession.options },
    contextReady: Number.isFinite(activeSession.data.context.tokenCount),
  };
}

function getJobDetails() {
  if (!activeSession) return null;
  return {
    jobName: activeSession.data.jobName,
    jobDescription: activeSession.data.jobDescription,
    requiredSkills: activeSession.data.requiredSkills,
    options: { ...activeSession.options },
  };
}

module.exports = {
  startSession,
  setContext,
  getRequestContext,
  shouldTranscribeQuestion,
  beginQuestion,
  finishQuestion,
  endSession,
  retryPendingWrites,
  getStatus,
  getJobDetails,
};

