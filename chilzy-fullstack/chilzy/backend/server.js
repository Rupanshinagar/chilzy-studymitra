const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ---------- persistence ----------
const DEFAULT_STATE = {
  xp: 0, level: 1, streak: 0, lastStudyDate: null, mood: 'happy',
  notes: [], weakTopics: [], accessories: [], dailyChallenge: null, lang: 'hinglish'
};
function loadState() {
  try { return Object.assign({}, DEFAULT_STATE, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
  catch (e) { return { ...DEFAULT_STATE }; }
}
function saveState(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
let state = loadState();

// ---------- RAG: chunk + keyword retrieval ----------
function chunkText(text) {
  const parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  parts.forEach(p => {
    if (p.length <= 600) chunks.push(p);
    else for (let i = 0; i < p.length; i += 600) chunks.push(p.slice(i, i + 600));
  });
  return chunks.length ? chunks : (text.trim() ? [text.trim()] : []);
}
function retrieve(query, k = 3) {
  const qwords = (query || '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const scored = state.notes.map(n => {
    const text = n.text.toLowerCase();
    let score = 0;
    qwords.forEach(w => { if (text.includes(w)) score++; });
    return { n, score };
  }).sort((a, b) => b.score - a.score);
  const top = scored.filter(s => s.score > 0).slice(0, k);
  return (top.length ? top : scored.slice(0, k)).map(s => s.n.text);
}

// ---------- rewards / language strings ----------
const REWARDS = { 2: '🎀 Bandana', 3: '🕶️ Cool Shades', 4: '🎩 Top Hat', 5: '👑 Crown', 6: '🦸 Cape', 7: '🏆 Champion Badge', 8: '💎 Diamond Collar' };
const STR = {
  hinglish: { sessionDone: "Yesss! Session complete 🎉 +20 XP. Proud of you, chal ab thoda break le lo ☕",
    breakDone: "Break khatam! Chalo wapas focus mode on karte hain 💪",
    skip: "Ehh, session skip kar diya? 😢 Koi baat nahi, par kal miss mat karna okay?",
    freezeWarn: "Kal miss ho gaya tha na? Streak freeze ne cover kar liya 🧊 Streak safe hai!",
    streakLost: "Kaafi din ho gaye padhai nahi ki 😢 Streak reset ho gayi, par chalo fresh start karte hain!",
    returnExcited: "Arre wapas aa gaye! Miss kiya tumne mujhe 🥹 Chalo phir se streak banate hain!",
    correct: "Sahi jawab! 🎉 +15 XP. Tum toh champ ho!",
    levelUp: (l) => "Level up! Naya unlock: " + l + " 🎉" },
  hindi: { sessionDone: "बहुत बढ़िया! सेशन पूरा हुआ 🎉 +20 XP। थोड़ा ब्रेक ले लो ☕",
    breakDone: "ब्रेक खत्म! वापस फोकस मोड ऑन करते हैं 💪",
    skip: "अरे, सेशन छोड़ दिया? 😢 कल मिस मत करना!",
    freezeWarn: "कल पढ़ाई नहीं हुई, कोई बात नहीं — स्ट्रीक फ्रीज़ ने बचा लिया 🧊",
    streakLost: "बहुत दिन हो गए पढ़ाई नहीं की 😢 स्ट्रीक रीसेट हो गई, फिर से शुरू करते हैं!",
    returnExcited: "वापस आ गए! तुम्हें मिस किया 🥹 फिर से स्ट्रीक बनाते हैं!",
    correct: "सही जवाब! 🎉 +15 XP मिला!",
    levelUp: (l) => "लेवल अप! नया अनलॉक: " + l + " 🎉" },
  english: { sessionDone: "Session complete! 🎉 +20 XP. Take a short break ☕",
    breakDone: "Break's over! Let's get back to focus mode 💪",
    skip: "Session skipped? 😢 Don't miss tomorrow, okay?",
    freezeWarn: "Missed yesterday, no worries — your streak freeze covered it 🧊",
    streakLost: "It's been a few days 😢 Streak reset, let's start fresh!",
    returnExcited: "You're back! I missed you 🥹 Let's rebuild that streak!",
    correct: "Correct! 🎉 +15 XP. You're a champ!",
    levelUp: (l) => "Level up! New unlock: " + l + " 🎉" }
};
function t(lang, key, arg) { const s = (STR[lang] || STR.hinglish)[key]; return typeof s === 'function' ? s(arg) : s; }
function addXP(amount) {
  state.xp += amount;
  const unlocked = [];
  while (state.xp >= state.level * 100) {
    state.xp -= state.level * 100; state.level++;
    if (REWARDS[state.level]) { state.accessories.push(REWARDS[state.level]); unlocked.push(REWARDS[state.level]); }
  }
  return unlocked;
}
function daysBetween(d1, d2) { return Math.round((new Date(d2) - new Date(d1)) / 86400000); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

// ---------- generation: optional real LLM (if ANTHROPIC_API_KEY set), else offline heuristic ----------
async function callAnthropic(prompt, wantJson) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || '').join('\n').trim();
    if (!text) return null;
    if (wantJson) { try { return JSON.parse(text.replace(/```json|```/g, '').trim()); } catch (e) { return null; } }
    return text;
  } catch (e) { return null; }
}
function langLine(lang) {
  if (lang === 'hindi') return 'हिंदी में जवाब दो.';
  if (lang === 'english') return 'Reply in English.';
  return 'Hinglish mein jawaab do.';
}
function stopwords() { return new Set(['this', 'that', 'with', 'from', 'have', 'will', 'your', 'they', 'their', 'which', 'about', 'there', 'these', 'those', 'into', 'were', 'when', 'what', 'where']); }
function keyTerm(sentence) {
  const words = sentence.replace(/[^a-zA-Z\s]/g, ' ').split(/\s+/).filter(w => w.length > 4 && !stopwords().has(w.toLowerCase()));
  words.sort((a, b) => b.length - a.length);
  return words[0] || null;
}
async function generateExplain(topic, lang) {
  const ctx = retrieve(topic, 2);
  const ai = await callAnthropic(`You are Chilzy, a cute chill virtual study-pet dog. Using this notes context, explain '${topic}' simply in 4-6 encouraging sentences. ${langLine(lang)}\n\nCONTEXT:\n${ctx.join('\n---\n')}`);
  if (ai) return ai;
  if (!ctx.length) return t(lang, 'skip') === '' ? '' : "Mujhe apne notes mein iske baare mein kuch nahi mila abhi, pehle notes daalo! 📖";
  const snippet = ctx[0].slice(0, 420);
  return "Yeh raha jo tumhare notes mein '" + topic + "' ke baare mein hai: \n\n" + snippet + (snippet.length >= 420 ? '...' : '') + "\n\nAgar aur deep explanation chahiye, backend mein ANTHROPIC_API_KEY daal do — phir main full AI mode mein aa jaunga! 🐶";
}
async function generateQuiz(topic, lang) {
  const ctx = retrieve(topic, 4);
  const ai = await callAnthropic(`Based on this notes context, write ONE multiple choice question testing understanding (not just recall). ${langLine(lang)} Respond ONLY as JSON, no fences: {"topic":"short topic","question":"...","options":["a","b","c","d"],"correctIndex":0}\n\nCONTEXT:\n${ctx.join('\n---\n')}`, true);
  if (ai && ai.question && ai.options) return ai;
  // offline heuristic fallback: fill-in-the-blank from a random sentence
  const pool = ctx.length ? ctx : state.notes.map(n => n.text);
  if (!pool.length) return null;
  const sentences = pool.join(' ').split(/(?<=[.!?])\s+/).filter(s => s.split(' ').length > 5);
  const sentence = sentences[Math.floor(Math.random() * sentences.length)] || pool[0];
  const answer = keyTerm(sentence);
  if (!answer) return null;
  const question = sentence.replace(new RegExp('\\b' + answer + '\\b'), '____');
  const others = state.notes.map(n => keyTerm(n.text)).filter(w => w && w !== answer);
  const distractors = Array.from(new Set(others)).slice(0, 3);
  while (distractors.length < 3) distractors.push(['Option', 'Concept', 'Term'][distractors.length]);
  const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
  return { topic: topic || 'Notes', question: 'Fill in the blank: ' + question, options, correctIndex: options.indexOf(answer) };
}
async function generateRevision(weakTopics, lang) {
  const ctx = weakTopics.map(tp => retrieve(tp, 2).join(' ')).join('\n---\n');
  const ai = await callAnthropic(`You are Chilzy, a cute chill study-pet. Student is weak in: ${weakTopics.join(', ')}. Using this context give a short bullet-style revision summary, one short line per topic, encouraging tone. ${langLine(lang)}\n\nCONTEXT:\n${ctx}`);
  if (ai) return ai;
  return weakTopics.map(tp => {
    const hit = retrieve(tp, 1)[0];
    return '• ' + tp + ': ' + (hit ? hit.slice(0, 140) + '...' : 'Notes mein detail nahi mili, revise karlo manually!');
  }).join('\n') + '\n\nChalo yeh topics phir se dekh lete hain, tum kar loge! 💪';
}

// ---------- routes ----------
app.get('/api/state', (req, res) => res.json(state));

app.post('/api/session-complete', (req, res) => {
  const mode = req.body.mode || 'work';
  let message;
  if (mode === 'work') {
    const unlocked = addXP(20);
    const today = todayISO();
    let wasReturning = false;
    if (state.lastStudyDate !== today) {
      if (state.lastStudyDate) {
        const missed = daysBetween(state.lastStudyDate, today) - 1;
        if (missed <= 0) state.streak++;
        else if (missed < 3) { state.streak++; wasReturning = true; }
        else state.streak = 1;
      } else state.streak = 1;
      state.lastStudyDate = today;
    }
    state.mood = wasReturning ? 'excited' : 'proud';
    message = wasReturning ? t(state.lang, 'returnExcited') : t(state.lang, 'sessionDone');
    if (unlocked.length) message += ' ' + t(state.lang, 'levelUp', unlocked.join(', '));
  } else {
    state.mood = 'happy';
    message = t(state.lang, 'breakDone');
  }
  saveState(state);
  res.json({ state, message });
});

app.post('/api/skip', (req, res) => {
  state.mood = 'sad';
  state.streak = Math.max(0, state.streak - 1);
  saveState(state);
  res.json({ state, message: t(state.lang, 'skip') });
});

app.get('/api/streak-check', (req, res) => {
  let message = null;
  if (state.lastStudyDate) {
    const today = todayISO();
    const missed = daysBetween(state.lastStudyDate, today) - 1;
    if (state.lastStudyDate !== today && missed > 0) {
      if (missed >= 3 && state.streak > 0) { state.streak = 0; state.mood = 'sad'; message = t(state.lang, 'streakLost'); saveState(state); }
      else if (missed < 3) { state.mood = 'sad'; message = t(state.lang, 'freezeWarn'); }
    }
  }
  res.json({ state, message });
});

app.post('/api/lang', (req, res) => { state.lang = req.body.lang || 'hinglish'; saveState(state); res.json(state); });
app.post('/api/voice', (req, res) => { state.voice = !!req.body.voice; saveState(state); res.json(state); });

app.post('/api/notes', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  const chunks = chunkText(text);
  chunks.forEach(c => state.notes.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), text: c }));
  saveState(state);
  res.json({ added: chunks.length, total: state.notes.length });
});

app.post('/api/notes/pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    const parsed = await pdfParse(req.file.buffer);
    const chunks = chunkText(parsed.text);
    chunks.forEach(c => state.notes.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), text: c }));
    saveState(state);
    res.json({ added: chunks.length, total: state.notes.length, filename: req.file.originalname });
  } catch (e) { res.status(500).json({ error: 'could not parse pdf' }); }
});

app.post('/api/explain', async (req, res) => {
  const topic = (req.body.topic || '').trim();
  if (!topic) return res.status(400).json({ error: 'topic required' });
  const text = await generateExplain(topic, state.lang);
  res.json({ text });
});

app.post('/api/quiz', async (req, res) => {
  const topic = (req.body.topic || '').trim();
  if (!state.notes.length) return res.status(400).json({ error: 'no notes yet' });
  const quiz = await generateQuiz(topic, state.lang);
  if (!quiz) return res.status(500).json({ error: 'could not generate quiz' });
  res.json(quiz);
});

app.post('/api/quiz/answer', (req, res) => {
  const { correct, topic } = req.body;
  let message, unlocked = [];
  if (correct) {
    unlocked = addXP(15); state.mood = 'proud';
    message = t(state.lang, 'correct') + (unlocked.length ? ' ' + t(state.lang, 'levelUp', unlocked.join(', ')) : '');
  } else {
    state.mood = 'neutral';
    if (topic && !state.weakTopics.includes(topic)) state.weakTopics.push(topic);
    message = state.lang === 'hindi' ? `"${topic}" थोड़ा कमज़ोर लगा, रिवीज़न लिस्ट में डाल दिया 😅`
      : state.lang === 'english' ? `Marked "${topic}" as a weak topic for revision 😅`
      : `"${topic}" ko weak topic mark kar diya — revise kar lenge! 😅`;
  }
  saveState(state);
  res.json({ state, message });
});

app.post('/api/revise', async (req, res) => {
  if (!state.weakTopics.length) return res.status(400).json({ error: 'no weak topics' });
  const text = await generateRevision(state.weakTopics, state.lang);
  res.json({ text });
});

app.get('/api/daily-challenge', async (req, res) => {
  const today = todayISO();
  if (state.dailyChallenge && state.dailyChallenge.date === today) return res.json(state.dailyChallenge);
  if (!state.notes.length) return res.json(null);
  const pick = state.notes[Math.floor(Math.random() * state.notes.length)];
  const quiz = await generateQuiz(pick.text.slice(0, 60), state.lang);
  if (!quiz) return res.json(null);
  state.dailyChallenge = { date: today, answered: false, topic: quiz.topic, question: quiz.question, options: quiz.options, correctIndex: quiz.correctIndex };
  saveState(state);
  res.json(state.dailyChallenge);
});

app.post('/api/daily-challenge/answer', (req, res) => {
  const dc = state.dailyChallenge;
  if (!dc || dc.answered) return res.status(400).json({ error: 'already answered' });
  dc.answered = true;
  const correct = req.body.index === dc.correctIndex;
  let message, unlocked = [];
  if (correct) { unlocked = addXP(15); state.mood = 'proud'; message = t(state.lang, 'correct') + (unlocked.length ? ' ' + t(state.lang, 'levelUp', unlocked.join(', ')) : ''); }
  else { state.mood = 'neutral'; if (!state.weakTopics.includes(dc.topic)) state.weakTopics.push(dc.topic); message = 'Koi na, agli baar sahi karenge! 😊'; }
  saveState(state);
  res.json({ state, message, correct });
});

app.listen(PORT, () => console.log(`Chilzy backend running on http://localhost:${PORT}`));
