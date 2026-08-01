const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Interim local storage for lessons extracted from recorded postmortems/talks.
// This is NOT the real RAG/Confluence integration from the roadmap — it's a
// plain JSON file so captured lessons aren't lost while that's built later.
// No semantic search yet: "surface relevant remediation steps in real time"
// needs embeddings + retrieval, which this doesn't do. This just captures
// and stores structured summaries so nothing is lost in the meantime.
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, '..', 'data');
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLessons() {
  ensureDataDir();
  if (!fs.existsSync(LESSONS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LESSONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[lessonsStore] failed to parse lessons.json, starting fresh (file left untouched):', err);
    return [];
  }
}

/**
 * Saves a new lesson entry.
 * @param {Object} entry
 * @param {string} entry.label - what this came from, e.g. a video title you typed in
 * @param {string} entry.summary - the structured summary text from Gemini
 */
function saveLesson(entry) {
  const lessons = loadLessons();
  const record = {
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
    label: entry.label || '(untitled)',
    summary: entry.summary,
  };
  lessons.push(record);
  ensureDataDir();
  fs.writeFileSync(LESSONS_FILE, JSON.stringify(lessons, null, 2), 'utf8');
  return record;
}

function getAllLessons() {
  return loadLessons();
}

module.exports = { saveLesson, getAllLessons };
