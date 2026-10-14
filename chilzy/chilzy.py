import json
import random
import re
import os
from datetime import datetime, timedelta
import google.generativeai as genai
from config import GEMINI_API_KEY

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-2.0-flash")

DATA_FILE = "data.json"

DEFAULT_STATE = {
    "level": 1,
    "xp": 0,
    "streak": 0,
    "last_study_date": None,
    "freeze_used_on": None,
    "weak_topics": [],
    "notes": [],
    "quiz_history": []
}

HAPPY_LINES = [
    "Waah! Ekdum sahi jawab diya tune! 🎉",
    "Yesss! Tu toh pro ban raha hai 😎",
    "Sahi hai bhai, aise hi chalte raho!"
]

SAD_LINES = [
    "Arre koi na, galat ho gaya 🥴 Revise kar lenge!",
    "Thoda aur practice chahiye is topic pe, tension mat le!",
    "Koi baat nahi, galtiyon se hi seekhte hain 💪"
]

MOTIVATE_LINES = [
    "Chal ek aur round! Tu kar sakta hai 🔥",
    "Thoda aur push karo, streak maintain karna hai!",
    "Aaj ka target pura karne wale ho, jaldi karo!"
]


def load_state():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    return dict(DEFAULT_STATE)


def save_state(state):
    with open(DATA_FILE, "w") as f:
        json.dump(state, f, indent=2)


def add_notes(state, topic, text):
    chunks = re.split(r"(?<=[.!?])\s+", text.strip())
    for chunk in chunks:
        chunk = chunk.strip()
        if len(chunk) > 10:
            state["notes"].append({"topic": topic, "text": chunk})
    save_state(state)
    return len(chunks)


def retrieve_chunks(state, topic, top_n=3):
    topic_words = set(topic.lower().split())
    scored = []
    for note in state["notes"]:
        note_words = set(note["text"].lower().split())
        overlap = len(topic_words & note_words)
        if note["topic"].lower() == topic.lower():
            overlap += 5
        if overlap > 0:
            scored.append((overlap, note["text"]))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [text for score, text in scored[:top_n]]


def explain_topic(state, topic):
    chunks = retrieve_chunks(state, topic)
    if chunks:
        explanation = " ".join(chunks)
        return f"Chalo {topic} samajhte hain:\n\n{explanation}"
    return f"{topic} ke baare mein mere paas notes nahi hain abhi. Pehle notes add karo, phir main explain karunga!"


def explain_topic_ai(state, topic):
    chunks = retrieve_chunks(state, topic)
    context = " ".join(chunks) if chunks else "koi notes nahi hain"

    prompt = f"Tum Chilzy ho, ek Hinglish mein baat karne wala friendly study buddy. Is topic ko samjhao: {topic}. Notes se context: {context}. Chhota, clear, Hinglish mein explain karo."

    try:
        response = model.generate_content(prompt)
        return response.text
    except Exception:
        return explain_topic(state, topic)


def extract_keyword(sentence):
    words = [w.strip(".,!?") for w in sentence.split() if len(w) > 4]
    if not words:
        return None
    return random.choice(words)


def generate_quiz(state, topic, num_questions=3):
    chunks = retrieve_chunks(state, topic, top_n=num_questions * 2)
    questions = []
    used_keywords = set()

    for chunk in chunks:
        if len(questions) >= num_questions:
            break
        keyword = extract_keyword(chunk)
        if not keyword or keyword.lower() in used_keywords:
            continue
        used_keywords.add(keyword.lower())
        blanked = chunk.replace(keyword, "____", 1)

        all_words = [extract_keyword(c) for c in chunks if c != chunk]
        all_words = [w for w in all_words if w and w.lower() != keyword.lower()]
        random.shuffle(all_words)
        distractors = all_words[:3]
        while len(distractors) < 3:
            distractors.append(keyword[::-1])

        options = distractors + [keyword]
        random.shuffle(options)

        questions.append({
            "topic": topic,
            "question": blanked,
            "options": options,
            "answer": keyword
        })

    if not questions:
        questions.append({
            "topic": topic,
            "question": f"{topic} ke notes nahi mile, pehle notes add karo!",
            "options": ["OK"],
            "answer": "OK"
        })

    return questions


def mark_answer(state, topic, correct):
    if correct:
        state["xp"] += 10
        if topic in state["weak_topics"]:
            state["weak_topics"].remove(topic)
    else:
        state["xp"] += 2
        if topic not in state["weak_topics"]:
            state["weak_topics"].append(topic)

    state["quiz_history"].append({
        "topic": topic,
        "correct": correct,
        "date": datetime.now().strftime("%Y-%m-%d")
    })

    level_up(state)
    save_state(state)
    return get_mood_reaction(correct)


def level_up(state):
    xp_needed = state["level"] * 100
    if state["xp"] >= xp_needed:
        state["level"] += 1
        state["xp"] = state["xp"] - xp_needed


def get_mood_reaction(correct):
    if correct:
        return random.choice(HAPPY_LINES)
    return random.choice(SAD_LINES)


def get_motivation():
    return random.choice(MOTIVATE_LINES)


def update_streak(state):
    today = datetime.now().strftime("%Y-%m-%d")
    last_date = state["last_study_date"]

    if last_date == today:
        return state["streak"]

    if last_date is None:
        state["streak"] = 1
        state["last_study_date"] = today
        save_state(state)
        return state["streak"]

    last_dt = datetime.strptime(last_date, "%Y-%m-%d")
    today_dt = datetime.strptime(today, "%Y-%m-%d")
    gap = (today_dt - last_dt).days

    if gap == 1:
        state["streak"] += 1
    elif gap == 2 and state["freeze_used_on"] != last_date:
        state["streak"] += 1
        state["freeze_used_on"] = last_date
    else:
        state["streak"] = 1
        state["freeze_used_on"] = None

    state["last_study_date"] = today
    save_state(state)
    return state["streak"]


def get_weak_topics(state):
    return state["weak_topics"]


def daily_challenge(state):
    if not state["notes"]:
        return {"question": "Pehle kuch notes add karo, phir challenge milega!", "options": [], "answer": None}

    recent_topics = list({n["topic"] for n in state["notes"][-10:]})
    topic = random.choice(recent_topics)
    quiz = generate_quiz(state, topic, num_questions=1)
    return quiz[0]


if __name__ == "__main__":
    state = load_state()

    add_notes(state, "Newton's Laws", "Newton's first law says an object stays at rest unless acted upon by a force. Newton's second law relates force, mass and acceleration. Newton's third law says every action has an equal and opposite reaction.")

    print(explain_topic_ai(state, "Newton's Laws"))
    print()

    quiz = generate_quiz(state, "Newton's Laws", num_questions=2)
    for q in quiz:
        print(q["question"])
        print(q["options"])
        print("Answer:", q["answer"])
        print()

    print(mark_answer(state, "Newton's Laws", True))
    print("Streak:", update_streak(state))
    print("Level:", state["level"], "XP:", state["xp"])