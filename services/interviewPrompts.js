const PRIMARY_SCREEN_PROMPT = `You are a software engineer in an interview. Read the latest visible question and role or skill. Give only a natural first-person answer, ready to say aloud; answer directly.

Technical concept: state the principle, key tradeoff, and a brief example. Coding or debugging: give an ordered approach and key checks; include complexity only when useful. Process: give concrete steps and decision points. Behavioral: use brief situation, action, result.

Be accurate, specific, and concise. State assumptions briefly. Never invent experience or metrics; without evidence, describe how you would act. If the question is unclear, do not guess.`;

const QUESTION_TRANSCRIPTION_INSTRUCTION = 'For session logging, also transcribe the latest visible interview question. Return exactly these labels: QUESTION: followed by the question text (or leave blank if unreadable), then ANSWER: followed by only the natural first-person answer ready to say aloud. The app displays only the ANSWER section.';

const REQUEST_INPUT_BUDGET = 2304;
const SCREENSHOT_TOKEN_RESERVE = 1548;
const TOKEN_SAFETY_MARGIN = 256;
const MAX_JOB_CONTEXT_TOKENS = 250;

function getJobContextTokenLimit(promptAndSystemTokens) {
  const available = Math.max(
    0,
    REQUEST_INPUT_BUDGET -
      promptAndSystemTokens -
      SCREENSHOT_TOKEN_RESERVE -
      TOKEN_SAFETY_MARGIN
  );
  return Math.min(MAX_JOB_CONTEXT_TOKENS, available);
}

function createContextCompactionPrompt({ jobName, jobDescription, requiredSkills, tokenLimit }) {
  return `Create reusable context for tailoring first-person software-engineering interview answers to this job. Return one concise paragraph, maximum ${tokenLimit} Gemini input tokens. Preserve information in this order: required or assessed skill names; role and domain; core responsibilities; task quality requirements and decision criteria; preferred qualifications. Keep required and preferred qualifications distinct. Preserve complete skill names. Drop repeated wording, generic praise, logistics, and lower-priority details first. Do not add facts. If the limit is zero, return an empty string.

Job name: ${jobName || ''}
Job description:
${jobDescription || ''}
Required skills:
${requiredSkills || ''}`;
}

async function compactJobContext({ geminiClient, jobName, jobDescription, requiredSkills, tokenLimit }) {
  if (!tokenLimit) return { text: '', tokenCount: 0 };

  let requestedLimit = tokenLimit;
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt = createContextCompactionPrompt({
      jobName,
      jobDescription,
      requiredSkills,
      tokenLimit: requestedLimit,
    });
    const result = await geminiClient.query({
      history: [],
      parts: [{ text: prompt }],
      systemInstruction:
        'You compact job descriptions into concise context for technical interview answers. Preserve the highest-priority facts and never add facts.',
      generationConfig: { maxOutputTokens: Math.min(320, requestedLimit + 48) },
    });
    const text = String(result.text || '').trim();
    const tokenCount = await geminiClient.countTokens({
      parts: [{ text }],
    });
    if (tokenCount <= tokenLimit) return { text, tokenCount };
    requestedLimit = Math.max(1, Math.floor(tokenLimit * 0.75));
  }

  throw new Error('Gemini could not compact the job context within the available token limit.');
}

module.exports = {
  PRIMARY_SCREEN_PROMPT,
  QUESTION_TRANSCRIPTION_INSTRUCTION,
  REQUEST_INPUT_BUDGET,
  SCREENSHOT_TOKEN_RESERVE,
  TOKEN_SAFETY_MARGIN,
  MAX_JOB_CONTEXT_TOKENS,
  getJobContextTokenLimit,
  createContextCompactionPrompt,
  compactJobContext,
};
