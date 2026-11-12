const { app } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const geminiClient = require('../services/geminiClient');

let activeProfile = '';

function getProfilePath() {
  return path.join(app.getPath('userData'), 'interview-profile.json');
}

async function initializeInterviewProfile() {
  try {
    const raw = await fs.readFile(getProfilePath(), 'utf8');
    const saved = JSON.parse(raw);
    activeProfile = typeof saved.profile === 'string' ? saved.profile : '';
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[interview-profile] Could not load saved profile:', error);
    }
    activeProfile = '';
  }
  return activeProfile;
}

function getInterviewProfile() {
  return activeProfile;
}

async function prepareInterviewProfile({ jobDescription, focusAreas = '', cvText = '' }) {
  const job = String(jobDescription || '').trim();
  if (!job) throw new Error('Paste the job description before preparing the interview profile.');
  if (job.length > 30000) throw new Error('The job description is too long. Please keep it under 30,000 characters.');

  const cv = String(cvText || '').trim();
  if (!cv) throw new Error('The local CV (cv.js) is empty or unavailable.');

  const prompt = [
    'Prepare a compact, reusable context profile for a real-time interview assistant.',
    'Analyze the job description against the candidate CV and the optional interview focus areas.',
    'Return ONLY the profile text, with these concise sections:',
    'ROLE: role and its main priorities.',
    'PRIORITIES: the 4-6 most important skills or evaluation dimensions.',
    'CANDIDATE EVIDENCE: the strongest directly supported experience/projects to use.',
    'GAPS: important requirements not evidenced by the CV; never imply the candidate has them.',
    'ANSWER GUIDANCE: how to frame answers naturally and accurately for this role.',
    'Keep the entire profile under 150 words. Use specific evidence, not generic advice.',
    'Do not invent experience, tools, achievements, metrics, qualifications, or projects.',
    'Distinguish practical use of AI tools/LLM APIs from training or developing machine-learning models.',
    '',
    'JOB DESCRIPTION:',
    job,
    '',
    'ADDITIONAL INTERVIEW FOCUS AREAS:',
    String(focusAreas || '').trim() || 'None provided.',
    '',
    'CANDIDATE CV (single source of truth):',
    cv
  ].join('\n');

  const { text } = await geminiClient.query({
    history: [],
    parts: [{ text: prompt }],
    systemInstruction: 'You are a precise interview-preparation analyst. Ground every candidate claim in the supplied CV. Return only the requested compact profile.'
  });

  const profile = String(text || '').trim();
  if (!profile) throw new Error('Gemini returned an empty interview profile.');
  if (profile.length > 2200) {
    throw new Error('The generated profile exceeded the compact-profile limit. Please prepare again.');
  }

  const saved = {
    profile,
    preparedAt: new Date().toISOString()
  };

  const filePath = getProfilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(saved, null, 2), 'utf8');
  activeProfile = profile;

  return { profile, preparedAt: saved.preparedAt };
}

async function clearInterviewProfile() {
  activeProfile = '';
  try {
    await fs.unlink(getProfilePath());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return true;
}

module.exports = {
  initializeInterviewProfile,
  getInterviewProfile,
  prepareInterviewProfile,
  clearInterviewProfile
};
