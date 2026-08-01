// Simple in-memory conversation history for the Gemini chat. Lives here so
// every entry point (typed chat, screen-read, voice) shares one
// conversation, and so Day 7's audit log can persist it later.

let history = [];

function getHistory() {
  return history;
}

function setHistory(newHistory) {
  history = newHistory;
}

function clear() {
  history = [];
}

module.exports = { getHistory, setHistory, clear };
