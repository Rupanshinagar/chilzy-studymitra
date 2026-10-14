let state = { xp: 0, level: 1, streak: 0, mood: 'happy', notes: [], weakTopics: [], accessories: [], lang: 'hinglish', voice: false };
let mode = 'work', totalSec = 25 * 60, remain = 25 * 60, timerId = null;
let quizPending = null;

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  if (!res.ok) throw new Error('api error ' + res.status);
  return res.json();
}

async function init() {
  try { state = Object.assign(state, await api('/api/state')); } catch (e) {}
  render();
  try { const chk = await api('/api/streak-check'); state = Object.assign(state, chk.state); if (chk.message) say(chk.message); render(); } catch (e) {}
  loadDaily();
}

function render() {
  document.getElementById('lvl').textContent = state.level;
  document.getElementById('xp').textContent = state.xp;
  document.getElementById('streak').textContent = state.streak;
  document.getElementById('xpfill').style.width = Math.min(100, (state.xp % 100)) + '%';
  document.getElementById('voiceToggle').checked = !!state.voice;
  document.getElementById('langSelect').value = state.lang;
  const faces = { happy: '🐶', neutral: '🐕', sad: '🐶💧', sleepy: '😴🐶', proud: '🐶✨', excited: '🐶🎉' };
  const accessory = state.accessories.length ? ' ' + state.accessories[state.accessories.length - 1].split(' ')[0] : '';
  document.getElementById('face').textContent = (faces[state.mood] || '🐶') + accessory;
  document.getElementById('notesCount').textContent = state.notes.length ? state.notes.length + ' note chunks saved' : '';
  renderWeak(); renderBadges();
}
function renderBadges() {
  const el = document.getElementById('badgeList');
  el.innerHTML = state.accessories.length ? state.accessories.map(a => '<span class="weak" style="background:var(--accent)">' + escapeHtml(a) + '</span>').join(' ') : 'Abhi koi badge nahi — level up karke unlock karo!';
}
function renderWeak() {
  const el = document.getElementById('weakList');
  el.innerHTML = state.weakTopics.length ? state.weakTopics.map(t => '<span class="weak">' + escapeHtml(t) + '</span>').join(' ') : 'Koi weak topic nahi abhi — quiz do to pata chalega!';
}
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function say(text) {
  document.getElementById('bubble').textContent = text;
  if (state.voice && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = state.lang === 'english' ? 'en-US' : 'hi-IN';
      u.rate = 1.05; u.pitch = 1.2;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
}
function saveVoicePref() { state.voice = document.getElementById('voiceToggle').checked; api('/api/voice', { method: 'POST', body: JSON.stringify({ voice: state.voice }) }); }
function setLang() { state.lang = document.getElementById('langSelect').value; api('/api/lang', { method: 'POST', body: JSON.stringify({ lang: state.lang }) }); }

function showTab(name) {
  ['study', 'notes', 'stats'].forEach(t => {
    document.getElementById(t).classList.toggle('hidden', t !== name);
    document.getElementById('tab' + t[0].toUpperCase() + t.slice(1) + 'Btn').className = t === name ? '' : 'off';
  });
}

// ---- Pomodoro ----
function setMode(m) { mode = m; totalSec = m === 'work' ? 25 * 60 : 5 * 60; resetTimer(); }
function fmt(s) { const m = Math.floor(s / 60), ss = s % 60; return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0'); }
function startTimer() {
  if (timerId) return;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  timerId = setInterval(() => {
    remain--;
    document.getElementById('timerDisp').textContent = fmt(remain);
    if (remain <= 0) { clearInterval(timerId); timerId = null; onSessionComplete(); }
  }, 1000);
}
function pauseTimer() { if (timerId) { clearInterval(timerId); timerId = null; } document.getElementById('startBtn').disabled = false; document.getElementById('pauseBtn').disabled = true; }
function resetTimer() { pauseTimer(); remain = totalSec; document.getElementById('timerDisp').textContent = fmt(remain); }

async function onSessionComplete() {
  document.getElementById('startBtn').disabled = false; document.getElementById('pauseBtn').disabled = true;
  const res = await api('/api/session-complete', { method: 'POST', body: JSON.stringify({ mode }) });
  state = Object.assign(state, res.state); render(); say(res.message);
}
async function skipSession() {
  pauseTimer(); resetTimer();
  const res = await api('/api/skip', { method: 'POST' });
  state = Object.assign(state, res.state); render(); say(res.message);
}

// ---- notes / RAG ----
async function addNotes() {
  const text = document.getElementById('notesInput').value.trim();
  if (!text) return;
  const res = await api('/api/notes', { method: 'POST', body: JSON.stringify({ text }) });
  document.getElementById('notesInput').value = '';
  addMsg('Chilzy', 'Notes save ho gaye! ' + res.added + ' chunks add kiye maine apne brain mein 🧠✅');
  await refreshNotesCount(res.total); loadDaily();
}
async function handlePdfUpload(ev) {
  const file = ev.target.files[0]; if (!file) return;
  addMsg('Chilzy', 'PDF padh raha hu... 📄');
  const fd = new FormData(); fd.append('pdf', file);
  try {
    const res = await fetch('/api/notes/pdf', { method: 'POST', body: fd });
    const data = await res.json();
    document.getElementById('chatlog').lastChild.remove();
    if (!res.ok) { addMsg('Chilzy', 'PDF read nahi ho paya 😥'); return; }
    addMsg('Chilzy', file.name + ' se ' + data.added + ' chunks extract kiye! Ab in par bhi explain/quiz kar sakta hu 🧠');
    await refreshNotesCount(data.total); loadDaily();
  } catch (e) { document.getElementById('chatlog').lastChild.remove(); addMsg('Chilzy', 'PDF upload fail ho gaya 😥'); }
  ev.target.value = '';
}
async function refreshNotesCount(total) { state.notes = new Array(total || 0); document.getElementById('notesCount').textContent = total ? total + ' note chunks saved' : ''; }
function addMsg(who, text) {
  const log = document.getElementById('chatlog');
  const div = document.createElement('div');
  div.className = 'msg' + (who === 'You' ? ' you' : '');
  div.textContent = (who === 'You' ? '' : '🐶 ') + text;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
}

async function explainTopic() {
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) { addMsg('Chilzy', 'Pehle topic toh batao yrr 😅'); return; }
  addMsg('You', topic); addMsg('Chilzy', 'Soch raha hu... 🤔');
  try {
    const res = await api('/api/explain', { method: 'POST', body: JSON.stringify({ topic }) });
    document.getElementById('chatlog').lastChild.remove();
    addMsg('Chilzy', res.text); say(res.text.slice(0, 180));
  } catch (e) { document.getElementById('chatlog').lastChild.remove(); addMsg('Chilzy', 'Kuch gadbad ho gayi 😅'); }
}
async function quizMe() {
  const topic = document.getElementById('topicInput').value.trim() || 'the saved notes';
  addMsg('You', 'Quiz me on ' + topic); addMsg('Chilzy', 'Quiz bana raha hu... ⏳');
  try {
    const q = await api('/api/quiz', { method: 'POST', body: JSON.stringify({ topic }) });
    document.getElementById('chatlog').lastChild.remove();
    showQuiz(q, document.getElementById('chatlog'));
  } catch (e) { document.getElementById('chatlog').lastChild.remove(); addMsg('Chilzy', 'Pehle kuch notes toh daalo, tab quiz banaunga! 📖'); }
}
function showQuiz(q, container) {
  quizPending = q;
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = '<div class="quizq">📝 ' + escapeHtml(q.question) + '</div>';
  q.options.forEach((opt, i) => {
    const b = document.createElement('button'); b.className = 'opt'; b.textContent = opt;
    b.onclick = () => answerQuiz(i, div, q, false);
    div.appendChild(b);
  });
  container.appendChild(div); container.scrollTop = container.scrollHeight;
}
async function answerQuiz(i, container, q, isDaily) {
  const correct = i === q.correctIndex;
  container.querySelectorAll('.opt').forEach((b, idx) => { b.disabled = true; if (idx === q.correctIndex) b.classList.add('correct'); else if (idx === i) b.classList.add('wrong'); });
  const ep = isDaily ? '/api/daily-challenge/answer' : '/api/quiz/answer';
  const body = isDaily ? { index: i } : { correct, topic: q.topic };
  const res = await api(ep, { method: 'POST', body: JSON.stringify(body) });
  state = Object.assign(state, res.state); render(); say(res.message);
}
async function reviseWeak() {
  if (!state.weakTopics.length) { addMsg('Chilzy', 'Abhi koi weak topic nahi hai, quiz khelo pehle! 😄'); return; }
  addMsg('You', 'Revise weak topics'); addMsg('Chilzy', 'Revision taiyar kar raha hu... 📚');
  try {
    const res = await api('/api/revise', { method: 'POST' });
    document.getElementById('chatlog').lastChild.remove();
    addMsg('Chilzy', res.text); say('Revision ready hai, neeche dekho! 📖');
  } catch (e) { document.getElementById('chatlog').lastChild.remove(); addMsg('Chilzy', 'Abhi revision nahi ban paya 😅'); }
}

// ---- daily challenge ----
async function loadDaily() {
  const box = document.getElementById('dailyBox');
  try {
    const dc = await api('/api/daily-challenge');
    box.innerHTML = '';
    if (!dc) { box.textContent = 'Notes daalo, roz ek naya challenge milega!'; return; }
    if (dc.answered) { box.textContent = '✅ Aaj ka challenge ho gaya! ("' + dc.topic + '") Kal phir milenge.'; return; }
    const q = { question: dc.question, options: dc.options, correctIndex: dc.correctIndex, topic: dc.topic };
    box.innerHTML = '<div class="quizq">' + escapeHtml(q.question) + '</div>';
    q.options.forEach((opt, i) => {
      const b = document.createElement('button'); b.className = 'opt'; b.textContent = opt;
      b.onclick = () => answerQuiz(i, box, q, true);
      box.appendChild(b);
    });
  } catch (e) { box.textContent = 'Notes daalo, roz ek naya challenge milega!'; }
}

document.getElementById('timerDisp').textContent = fmt(remain);
init();
