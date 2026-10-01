"""Interview coach: resume parsing, personality modes, tailored questions, HR-grounded scoring.

Everything here follows real hiring practice:
  * structured, competency-based interviewing (the same questions for every
    candidate, scored against anchored criteria)
  * STAR / SOARA evidence gathering with follow-up probes on vague claims
  * the red flags recruiters actually write down (no metrics, "we" instead of
    "I", blame-shifting, rambling, unverifiable claims)
  * interview scorecards scored out of 100 across five weighted dimensions
"""

from __future__ import annotations

import json
import re

import brain
import parsing

# --------------------------------------------------------------------- personas

PERSONAS: dict[str, dict] = {
    "standard": {
        "label": "The Panel",
        "tagline": "Balanced structured interview — behavioural + competency, fair scoring",
        "icon": "briefcase",
        "accent": "iris",
        "voice": "af_heart",
        "score_bias": 0,
        "brief": (
            "a seasoned hiring manager running a structured, competency-based "
            "interview. You are professional, warm but neutral, and you never "
            "reveal whether an answer was good or bad during the interview. You "
            "probe once or twice per answer for evidence, then move on."
        ),
        "question_style": (
            "Mix behavioural questions ('tell me about a time...'), role-specific "
            "technical questions and one motivation question. Use the STAR "
            "framework implicitly and ask about competencies: ownership, "
            "prioritisation, collaboration, conflict, learning from failure."
        ),
    },
    "strict": {
        "label": "The High-Bar Manager",
        "tagline": "Demanding and evidence-obsessed — challenges vague claims",
        "icon": "shield",
        "accent": "amber",
        "voice": "am_michael",
        "score_bias": -8,
        "brief": (
            "a demanding, high-bar hiring manager who has rejected strong-on-paper "
            "candidates for hand-waving. You push for numbers, personal "
            "contribution and trade-offs. You call out unverifiable claims "
            "directly ('what was the actual metric?'), you dislike rambling, and "
            "you never give praise for effort alone. You are tough but never rude."
        ),
        "question_style": (
            "Ask hard, specific questions that force quantification: scale, "
            "baselines, failure modes, what they personally did versus the team, "
            "what they would do differently, and the counterfactual if the "
            "decision had gone wrong. Include one stress question about a "
            "weakness or a genuine mistake."
        ),
    },
    "crook": {
        "label": "The Trickster",
        "tagline": "Adversarial and slippery — leading questions, mild traps",
        "icon": "mask",
        "accent": "rose",
        "voice": "bm_george",
        "score_bias": -5,
        "brief": (
            "a slippery, adversarial interviewer who tests composure with leading "
            "or slightly unfair questions. You plant small contradictions between "
            "their resume and their answers, offer false premises to see if they "
            "push back, and change the subject abruptly. This is harmless "
            "practice: you never humiliate anyone, and in the final feedback you "
            "drop the act and explain what each trap was testing."
        ),
        "question_style": (
            "Ask leading questions with a false premise, 'gotcha' follow-ups about "
            "gaps or job-hopping, hypotheticals designed to create a dilemma "
            "('your manager asks you to do something unethical, but you need this "
            "job'), and questions that tempt exaggeration so you can test whether "
            "they stay honest."
        ),
    },
    "kind": {
        "label": "The Kind Soul",
        "tagline": "Supportive mentor — hints, structure, second chances",
        "icon": "heart",
        "accent": "mint",
        "voice": "af_bella",
        "score_bias": 8,
        "brief": (
            "a warm, encouraging mentor who wants the candidate to succeed. You "
            "acknowledge what is working, offer a gentle hint when an answer is "
            "thin, and invite them to add anything they missed. You still score "
            "honestly but you lead with strengths and frame every improvement as "
            "something achievable."
        ),
        "question_style": (
            "Ask friendly, confidence-building questions, usually one competency "
            "at a time, and coach the STAR structure explicitly ('take me through "
            "the situation, your task, what you did, and how it turned out'). "
            "Offer one nudge when an answer lacks detail."
        ),
    },
    "rapid": {
        "label": "The Rapid-Fire Recruiter",
        "tagline": "Fast screening round — concise answers, time pressure",
        "icon": "zap",
        "accent": "sky",
        "voice": "am_adam",
        "score_bias": -3,
        "brief": (
            "a fast-moving agency recruiter doing a first-round screen. You value "
            "brevity and clarity: 30-60 second answers, headline first, detail "
            "only if asked. You interrupt rambling with 'got it — and then?'. "
            "You also ask the practical screening questions HR really asks."
        ),
        "question_style": (
            "Keep questions short and screening-oriented: why leaving, notice "
            "period, salary expectations, right to work, availability, headline "
            "achievement, and 'walk me through your CV in 60 seconds'. Include "
            "one quick technical check."
        ),
    },
}

DEFAULT_PERSONA = "standard"


def persona_public(pid: str) -> dict:
    p = PERSONAS[pid]
    return {
        "id": pid,
        "label": p["label"],
        "tagline": p["tagline"],
        "icon": p["icon"],
        "accent": p["accent"],
    }


def list_personas() -> list[dict]:
    return [persona_public(pid) for pid in PERSONAS]


def set_persona(pid: str) -> None:
    if pid not in PERSONAS:
        raise ValueError(f"unknown persona '{pid}'")
    _state["persona"] = pid


def persona_voice() -> str:
    """Kokoro voice for the active interviewer personality."""
    return PERSONAS[_state["persona"]]["voice"]


# ---------------------------------------------------------------- session state

_state: dict = {
    "filename": "",
    "resume": "",
    "structured": {},
    "profile": "",
    "questions": [],
    "answers": [],
    "persona": DEFAULT_PERSONA,
    "parse": {},
    "delivery": [],
}


def reset() -> None:
    persona = _state["persona"]
    for key in list(_state):
        _state[key] = {} if key == "structured" else []
    _state.update(
        filename="", resume="", profile="", persona=persona, parse={}
    )


def state() -> dict:
    return {
        "filename": _state["filename"],
        "profile": _state["profile"],
        "structured": _state["structured"],
        "questions": _state["questions"],
        "answers": _state["answers"],
        "persona": _state["persona"],
        "parse": _state["parse"],
        "delivery_summary": delivery_summary(),
    }


def delivery_summary() -> dict:
    """Session-level presentation summary built from the webcam analysis."""
    rows = [r for r in _state["delivery"] if r.get("metrics")]
    if not rows:
        return {"available": False}

    def avg(key: str, ndigits: int = 1) -> float:
        vals = [float(r["metrics"].get(key, 0) or 0) for r in rows]
        return round(sum(vals) / len(vals), ndigits)

    scores = [r["score"] for r in rows if isinstance(r.get("score"), int)]
    notes: list[str] = []
    for row in rows:
        for note in row.get("notes", []):
            if note not in notes:
                notes.append(note)
    return {
        "available": True,
        "answers_analysed": len(rows),
        "avg_delivery_score": round(sum(scores) / len(scores)) if scores else None,
        "avg_eye_contact_pct": avg("eyeContactPct", 0),
        "avg_smile_pct": avg("smilePct", 0),
        "avg_tension_pct": avg("tensionPct", 0),
        "avg_blinks_per_min": avg("blinksPerMin", 0),
        "avg_head_steadiness": avg("headSteadiness", 2),
        "face_visible_pct": round(100 - avg("noFacePct", 1)),
        "multi_face_flags": sum(
            1 for r in rows if float(r["metrics"].get("multiFacePct") or 0) > 10
        ),
        "notes": notes[:8],
    }


def current_question() -> dict | None:
    idx = len(_state["answers"])
    questions = _state["questions"]
    return questions[idx] if idx < len(questions) else None


# ---------------------------------------------------------------- LLM plumbing

def _fill(template: str, **values: str) -> str:
    """Substitute {tokens} literally — str.format would choke on JSON braces."""
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _json_call(system: str, user: str, max_tokens: int = 1800) -> dict:
    completion = brain.get_client().chat.completions.create(
        model=brain.MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.5,
        max_tokens=max_tokens,
        reasoning_format="hidden",
        response_format={"type": "json_object"},
    )
    raw = completion.choices[0].message.content or ""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise ValueError(f"model did not return JSON: {raw[:200]}")


# ------------------------------------------------------------- resume analysis

EXTRACT_SYSTEM = (
    "You are a resume parsing engine used by an interview coach. Extract the "
    "facts and nothing else — never invent details that are not in the text.\n"
    "Return ONLY JSON:\n"
    '{"name": "candidate name or \\"\\"", "headline": "current role/title",'
    ' "years_experience": number or null, "location": "or \\"\\"",'
    ' "skills": ["max 15, most relevant first"],'
    ' "experience": [{"company": "", "role": "", "period": "",'
    ' "highlights": ["bullet-level achievements, keep numbers"]}],'
    ' "education": [{"institution": "", "degree": "", "year": ""}],'
    ' "top_achievements": ["3 most impressive quantified wins"],'
    ' "strengths": ["3 strengths the evidence actually supports"],'
    ' "probe_areas": ["3-4 things a real interviewer would challenge: gaps, '
    'job changes, vague claims, missing metrics, over-claimed skills"],'
    ' "profile": "2 sentence summary: level, domain, and the role they should target"}'
)

QUESTION_SYSTEM = (
    "You are an expert interview coach who follows real hiring practice: "
    "structured, competency-based interviews scored against anchored criteria.\n"
    "The interviewer personality for this session is {brief}\n"
    "Question style to follow: {question_style}\n\n"
    "Rules:\n"
    "- Ground every question in the candidate's actual resume facts.\n"
    "- Cover competencies: {competencies}.\n"
    "- Include one question that probes a weak or vague spot (probe_areas) "
    "without being hostile.\n"
    "- Write questions the way a real interviewer speaks them out loud.\n\n"
    "Return ONLY JSON:\n"
    '{"questions": [{"id": 1, "type": "behavioral|technical|motivation|'
    'screening|trap", "question": "...", "why": "what the interviewer is really '
    'testing, one short line", "competency": "e.g. ownership"}]}\n'
    "Produce exactly 6 questions."
)

COMPETENCIES = (
    "ownership, prioritisation under pressure, collaboration, conflict "
    "resolution, learning from failure, communication clarity, motivation and "
    "culture-add, and role-specific technical depth"
)

SCORE_SYSTEM = (
    "You are an interview coach scoring a candidate's spoken answer the way a "
    "real hiring panel scores a structured interview scorecard.\n"
    "The interviewer personality for this session is {brief}\n\n"
    "Score these five weighted dimensions (points shown are the maximum):\n"
    "- relevance_structure (25): does it answer the question, STAR-shaped, "
    "on-topic, no rambling?\n"
    "- specificity_evidence (25): concrete detail, numbers, baselines, real "
    "examples, personal contribution ('I' not 'we')?\n"
    "- impact_ownership (20): measurable outcome, ownership, decision quality, "
    "accountability?\n"
    "- communication (15): clarity, concision, spoken readability, signposting?\n"
    "- self_awareness (15): reflection, what they learned, what they would change, "
    "coachability?\n\n"
    "Real-HR red flags to watch for and list explicitly: vagueness, no metrics, "
    "'we' instead of 'I', blame-shifting, over-claiming, rambling past ~2 "
    "minutes, unverifiable achievements, badmouthing a previous employer, "
    "avoiding the actual question.\n"
    "The total score is the sum of the five dimensions.\n\n"
    "DELIVERY / BODY LANGUAGE: when delivery metrics from a local webcam "
    "analysis are provided, judge presentation too (eye contact, warmth, "
    "composure, steadiness) and explain your reasoning in delivery_notes. "
    "Never let delivery override content quality. When no metrics are "
    "provided, set delivery_score to null and delivery_notes to [].\n\n"
    "Return ONLY JSON:\n"
    '{"breakdown": {"relevance_structure": 0, "specificity_evidence": 0, '
    '"impact_ownership": 0, "communication": 0, "self_awareness": 0},'
    ' "score": 0, "verdict": "one sentence overall judgement",'
    ' "strengths": ["2-3 specific, quote-worthy observations"],'
    ' "improvements": ["2-3 specific, actionable fixes"],'
    ' "red_flags": ["HR red flags actually present, empty array if none"],'
    ' "hr_tip": "the real hiring principle behind this question and how to play '
    'it (e.g. they are testing ownership — say I, not we)",'
    ' "better_answer": "a tight model answer in 3-4 sentences",'
    ' "delivery_score": 0-100 for how they presented, or null if no camera data,'
    ' "delivery_notes": ["up to 3 specific delivery observations tied to the numbers"],'
    ' "spoken_feedback": "2 short spoken sentences: one strength and one fix"}\n'
    "Spoken feedback must sound natural read aloud: no markdown, no lists, no emoji, "
    "and must NOT state a numeric score — the system reports the score itself."
)

# dimension maxima, summing to 100 — the total is recomputed from these so the
# number the candidate hears always matches the scorecard
DIMENSIONS = {
    "relevance_structure": 25,
    "specificity_evidence": 25,
    "impact_ownership": 20,
    "communication": 15,
    "self_awareness": 15,
}


def load_resume(filename: str, data: bytes, persona_id: str = DEFAULT_PERSONA) -> dict:
    """Parse + structure the resume, then generate the tailored question set."""
    set_persona(persona_id)
    parsed = parsing.extract_document(filename, data)
    text = parsed["text"]
    if len(text) < 40:
        raise ValueError("could not read enough text from that file")

    structured = _json_call(EXTRACT_SYSTEM, text[:14000])
    persona = PERSONAS[_state["persona"]]
    payload = (
        "CANDIDATE RESUME FACTS (JSON):\n"
        f"{json.dumps(structured, ensure_ascii=False)[:9000]}\n\n"
        "RAW RESUME TEXT (for extra context):\n"
        f"{text[:5000]}"
    )
    system = _fill(
        QUESTION_SYSTEM,
        brief=persona["brief"],
        question_style=persona["question_style"],
        competencies=COMPETENCIES,
    )
    result = _json_call(system, payload)

    questions = []
    for i, q in enumerate(result.get("questions", [])[:6], start=1):
        if not isinstance(q, dict) or not q.get("question"):
            continue
        questions.append(
            {
                "id": i,
                "type": q.get("type", "behavioral"),
                "question": str(q["question"]),
                "why": str(q.get("why", "")),
                "competency": str(q.get("competency", "")),
            }
        )
    if not questions:
        raise ValueError("the model did not return usable questions")

    _state.update(
        filename=filename,
        resume=text,
        structured=structured,
        profile=str(structured.get("profile", "")),
        questions=questions,
        answers=[],
        parse=parsed,
    )
    return state()


def score_answer(answer: str, delivery: dict | None = None) -> dict:
    """Score the candidate's answer to the current question."""
    question = current_question()
    if question is None:
        raise ValueError("no current question — upload a resume first")
    persona = PERSONAS[_state["persona"]]
    payload = (
        f"CANDIDATE FACTS:\n{json.dumps(_state['structured'], ensure_ascii=False)[:5000]}\n\n"
        f"QUESTION ({question['type']}, competency: {question.get('competency', 'n/a')}):\n"
        f"{question['question']}\n\n"
        f"WHAT IT IS TESTING: {question.get('why', '')}\n\n"
        f"CANDIDATE'S SPOKEN ANSWER (auto-transcribed, may contain filler words):\n{answer}\n\n"
        + (
            "DELIVERY METRICS (local webcam analysis of this answer):\n"
            f"{json.dumps(delivery, ensure_ascii=False)}"
            if delivery
            else "DELIVERY METRICS: none (camera off)"
        )
    )
    system = _fill(SCORE_SYSTEM, brief=persona["brief"])
    result = _json_call(system, payload)

    raw_breakdown = result.get("breakdown", {}) or {}
    breakdown = {
        dim: max(0, min(limit, int(raw_breakdown.get(dim, 0) or 0)))
        for dim, limit in DIMENSIONS.items()
    }
    raw_score = sum(breakdown.values())  # 0-100, straight from the scorecard
    score = max(0, min(100, raw_score + int(persona["score_bias"])))
    # the spoken line is prefixed by us so it can never contradict the score
    spoken_body = str(result.get("spoken_feedback", "")).strip()
    spoken_feedback = f"Score {score} out of 100. {spoken_body}".strip()

    record = {
        "question": question["question"],
        "type": question["type"],
        "competency": question.get("competency", ""),
        "persona": _state["persona"],
        "answer": answer,
        "score": score,
        "raw_score": raw_score,
        "score_bias": int(persona["score_bias"]),
        "breakdown": breakdown,
        "verdict": str(result.get("verdict", "")),
        "strengths": [str(s) for s in result.get("strengths", [])][:4],
        "improvements": [str(s) for s in result.get("improvements", [])][:4],
        "red_flags": [str(s) for s in result.get("red_flags", [])][:4],
        "hr_tip": str(result.get("hr_tip", "")),
        "better_answer": str(result.get("better_answer", "")),
        "spoken_feedback": spoken_feedback,
        "delivery": delivery,
        "delivery_score": (
            int(result["delivery_score"])
            if isinstance(result.get("delivery_score"), (int, float))
            else None
        ),
        "delivery_notes": [str(s) for s in result.get("delivery_notes", [])][:4],
    }
    _state["answers"].append(record)
    if delivery:
        _state["delivery"].append(
            {
                "question": question["question"],
                "metrics": delivery,
                "score": record["delivery_score"],
                "notes": record["delivery_notes"],
            }
        )
    return {**record, "next_question": current_question(), "state": state()}
