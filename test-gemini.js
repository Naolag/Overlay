
require('dotenv').config();

const key = process.env.GEMINI_API_KEY_1;
const start = Date.now();

async function test() {
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with OK.' }] }],
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    console.log('HTTP status:', response.status);
    console.log('Response:', await response.text());
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    console.log('Elapsed:', Date.now() - start, 'ms');
  }
}

if (!key) {
  console.log('GEMINI_API_KEY_1 is missing from .env');
} else {
  test();
}s