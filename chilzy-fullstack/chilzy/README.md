# Chilzy — AI Study Buddy (Frontend + Backend)

A Pomodoro study tracker with a virtual pet (mood, XP, levels, streaks, badges),
Gen-AI/RAG powered note explain/quiz/revision, a daily challenge, and voice-over —
built as a real **frontend + backend** project for your PBL.

## Structure
```
chilzy/
├── backend/        Node.js + Express API, JSON-file storage, RAG (chunk+retrieve),
│                    PDF text extraction, optional real LLM calls
│   ├── server.js
│   ├── package.json
│   └── data.json    (auto-created on first run)
└── frontend/        Plain HTML/CSS/JS UI, served by the backend
    ├── index.html
    ├── style.css
    └── app.js
```

## Run it (zero extra setup)
```
cd backend
npm install
npm start
```
Then open **http://localhost:3000** — that's it, frontend is served by the same server.

## How the RAG works
1. Notes (pasted text or uploaded PDF) are chunked (~600 chars) and stored server-side.
2. When you ask "Explain", "Quiz me" or "Revise weak topics", the backend retrieves the
   most relevant chunks by keyword overlap (retrieval step).
3. By default it **generates the answer offline** (extractive explanation, heuristic
   fill-in-the-blank quiz) — no API key needed, works immediately.

## Optional: real AI-generated answers
If you want Chilzy's Explain/Quiz/Revision to be written by an actual LLM instead of
the offline fallback, set an environment variable before `npm start`:
```
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```
The backend will then call Claude to generate the explanations/quizzes/revision text.
This step is completely optional — the app works fully without it.

## Notes
- Voice-over uses the browser's built-in Web Speech API (no backend/API needed).
- State (XP, streak, notes, badges, weak topics) persists in `backend/data.json`.
- This is a single-user local demo (fine for a PBL demo) — no login system.
