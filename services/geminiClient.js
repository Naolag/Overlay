// ---------------------------------------------------------------------------
// Thin wrapper around the Gemini API's generateContent REST endpoint.
// Supports multi-turn history and multimodal parts (text, image, audio) so
// the same function serves typed chat, screen-read, and voice queries.
// Kept isolated from Electron entirely so it can be tested standalone.
// ---------------------------------------------------------------------------

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiClientError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GeminiClientError';
    this.cause = cause;
  }
}

function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    throw new GeminiClientError(
      'No Gemini API key configured. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey'
    );
  }
  return apiKey;
}

/**
 * Sends a multi-turn, multimodal request to Gemini.
 * @param {Object} args
 * @param {Array} args.history - prior turns: [{role:'user'|'model', parts:[...]}]
 * @param {Array} args.parts - parts for the NEW user turn, e.g. [{text}], or
 *   [{text}, {inline_data:{mime_type,data}}] for image/audio input
 * @param {string} [args.systemInstruction] - persistent context/persona,
 *   applied via Gemini's system_instruction field (not stuffed into the
 *   user turn) — the correct mechanism for "always interpret this as X"
 *   framing, rather than repeating disambiguating text in every prompt.
 * @returns {Promise<{text: string, history: Array}>} updated history includes
 *   this turn and the model's reply — pass it back in on the next call
 */
async function query({ history = [], parts, systemInstruction }) {
  const apiKey = getApiKey();
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `${ENDPOINT_BASE}/${model}:generateContent`;

  const contents = [...history, { role: 'user', parts }];

  const body = { contents };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new GeminiClientError('Network error reaching Gemini API — check your connection.', networkErr);
  }

  if (!response.ok) {
    const status = response.status;
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (_) {
      /* ignore */
    }

    if (status === 429) {
      throw new GeminiClientError('Rate limited by Gemini free tier — wait a moment and try again.');
    }
    if (status === 400 || status === 403) {
      throw new GeminiClientError(
        'Gemini API rejected the request — check your API key, or (if this was a voice/screen ' +
          'query) the audio/image format.',
        bodyText
      );
    }
    throw new GeminiClientError(`Gemini API returned an error (HTTP ${status}).`, bodyText);
  }

  const data = await response.json();
  const responseParts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = responseParts.map((p) => p.text || '').join('');

  if (!text) {
    throw new GeminiClientError('Gemini API returned an empty or unexpected response shape.', data);
  }

  const modelTurn = { role: 'model', parts: [{ text }] };
  return { text, history: [...contents, modelTurn] };
}

module.exports = { query, GeminiClientError };