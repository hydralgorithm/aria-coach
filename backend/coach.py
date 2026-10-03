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
from pathlib import Path

from . import brain, parsing, store

_AUDIO_DIR = Path(__file__).resolve().parent.parent / "static" / "audio"

# --------------------------------------------------------------------- personas

PERSONAS: dict[str, dict] = {
    "standard": {
        "label": "The Structured Panel",
        "tagline": "Balanced competency-based interview — behavioural questions, fair scoring",
        "icon": "briefcase",
        "accent": "iris",
        "voice": "af_heart",
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
        "label": "The Bar-Raiser",
        "tagline": "High-bar and evidence-obsessed — challenges vague claims",
        "icon": "shield",
        "accent": "amber",
        "voice": "am_michael",
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
        "label": "The Stress Interviewer",
        "tagline": "Adversarial stress round — leading questions and mild traps",
        "icon": "mask",
        "accent": "rose",
        "voice": "bm_george",
        "advanced": True,
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
        "label": "The Talent Coach",
        "tagline": "Supportive coaching round — hints, structure, second chances",
        "icon": "mint",
        "accent": "mint",
        "voice": "af_bella",
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
        "label": "The Phone Screener",
        "tagline": "Fast first-round screen — concise answers under time pressure",
        "icon": "zap",
        "accent": "sky",
        "voice": "am_adam",
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


def _preset_url(pid: str) -> str:
    """URL for the pre-rendered persona greeting, cache-busted by mtime.

    Static files carry no Cache-Control, so browsers may cache them
    heuristically. Without the version a regenerated greeting would not play.
    """
    path = _AUDIO_DIR / f"persona_{pid}.wav"
    try:
        version = int(path.stat().st_mtime)
    except OSError:
        version = 0
    return f"/static/audio/persona_{pid}.wav?v={version}"


def persona_public(pid: str) -> dict:
    p = PERSONAS[pid]
    return {
        "id": pid,
        "label": p["label"],
        "tagline": p["tagline"],
        "icon": p["icon"],
        "accent": p["accent"],
        "advanced": bool(p.get("advanced")),
        "audio_url": _preset_url(pid),
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
    "setup": [],
    "jd": "",
    "coverage": {},
    # id of the row in the local history DB for this practice session
    "session_id": None,
    # question id -> first-attempt row id, so a transcript correction can be
    # written back over the same attempt instead of adding a retry
    "answer_rows": {},
}


def reset() -> None:
    persona = _state["persona"]
    for key in list(_state):
        _state[key] = {} if key == "structured" else []
    _state["answer_rows"] = {}
    _state.update(
        filename="",
        resume="",
        profile="",
        persona=persona,
        parse={},
        jd="",
        coverage={},
        session_id=None,
    )


def _behaviour() -> dict:
    """Confidence measured as behaviour chosen, never read from a face.

    answered → corrected → retried → improved. Cumulative across the local
    practice history so the candidate can see the habit grow.
    """
    try:
        return store.behaviour_stats()
    except Exception as exc:  # noqa: BLE001 - history must never break practice
        print(f"  [store] could not read behaviour: {exc}")
        return {
            "sessions": 0,
            "answered": 0,
            "corrected": 0,
            "retried": 0,
            "improved": 0,
        }


def state() -> dict:
    return {
        "filename": _state["filename"],
        "profile": _state["profile"],
        "structured": _state["structured"],
        "questions": _state["questions"],
        "answers": _state["answers"],
        "persona": _state["persona"],
        "parse": _state["parse"],
        "jd": _state["jd"],
        "coverage": _state["coverage"],
        "setup_summary": setup_summary(),
        "behaviour": _behaviour(),
    }


def setup_summary() -> dict:
    """Session-level camera-setup summary.

    This is framing and visibility only. Aria never reads emotion from a face
    (EU AI Act Art. 5(1)(f)), and none of these numbers touch the score.
    """
    rows = [r for r in _state["setup"] if r.get("metrics")]
    if not rows:
        return {"available": False}

    def avg(key: str, ndigits: int = 0) -> float:
        vals = [float(r["metrics"].get(key, 0) or 0) for r in rows]
        return round(sum(vals) / len(vals), ndigits)

    notes: list[str] = []
    for row in rows:
        for note in row.get("notes", []):
            if note not in notes:
                notes.append(note)
    return {
        "available": True,
        "answers_analysed": len(rows),
        "face_visible_pct": round(100 - avg("noFacePct", 1)),
        "avg_facing_pct": avg("facingPct", 0),
        "multi_face_flags": sum(
            1 for r in rows if float(r["metrics"].get("multiFacePct") or 0) > 10
        ),
        "notes": notes[:8],
    }


# --------------------------------------------------------- practice history

def _start_session() -> int | None:
    """Open a local history row for this session. Never fatal."""
    try:
        return store.start_session(
            _state["filename"], _state["persona"], bool(_state["jd"]), _state["profile"]
        )
    except Exception as exc:  # noqa: BLE001 - history must never break practice
        print(f"  [store] could not start a history session: {exc}")
        return None


def _persist_answer(question: dict, record: dict, attempt: int, edited: bool) -> int | None:
    """Record an answer in the local history DB. Never fatal.

    Returns the stored row id so a later transcript correction can overwrite the
    same row. Only first attempts are remembered: retries are separate rows.
    """
    try:
        row_id = store.save_answer(
            _state.get("session_id"),
            {
                "question_id": int(question.get("id") or 0),
                "question": record.get("question", ""),
                "competency": record.get("competency", ""),
                "qtype": record.get("type", ""),
                "persona": record.get("persona", ""),
                "attempt": attempt,
                "edited": edited,
                "score": record.get("score", 0),
                "breakdown": record.get("breakdown", {}),
                "answer": record.get("answer", ""),
            },
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  [store] could not save the answer: {exc}")
        return None
    if attempt == 1:
        try:
            _state["answer_rows"][int(question.get("id") or 0)] = row_id
        except Exception:  # noqa: BLE001 - bookkeeping must never break scoring
            pass
    return row_id


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
    """JSON completion via the cloud-first, local-fallback path in brain.py."""
    raw, _engine = brain.complete(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.5,
        max_tokens=max_tokens,
        json_mode=True,
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
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

COVERAGE_SYSTEM = (
    "You compare a job description against a candidate's resume and decide, "
    "requirement by requirement, whether the resume actually shows evidence.\n"
    "Rules:\n"
    "- Extract only requirements the EMPLOYER states (must-haves, nice-to-haves, "
    "core responsibilities). Never invent a requirement that is not in the job "
    "description.\n"
    "- For each requirement, copy the supporting resume evidence VERBATIM (a "
    "short span). If the resume shows nothing, leave evidence empty - never "
    "paraphrase and never invent evidence.\n"
    "- confidence: 'strong' (clear specific evidence), 'partial' (related but "
    "thin), 'gap' (required and the resume shows nothing), 'unknown'.\n"
    "- importance: high for must-haves, medium for responsibilities, low for "
    "nice-to-haves.\n"
    "- Return 5-10 requirements, most important first.\n"
    "Return ONLY JSON:\n"
    '{"summary": "one line on overall fit", '
    '"requirements": [{"requirement": "...", '
    '"kind": "must_have|nice_to_have|responsibility", '
    '"evidence": "verbatim resume span, or empty", '
    '"confidence": "strong|partial|gap|unknown", '
    '"importance": "high|medium|low", "why": "one short line"}]}'
)

QUESTION_SYSTEM = (
    "You are an expert interview coach who follows real hiring practice: "
    "structured, competency-based interviews scored against anchored criteria.\n"
    "The interviewer personality for this session is {brief}\n"
    "Question style to follow: {question_style}\n\n"
    "{weak}"
    "{focus}"
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
    "Judge the WORDS ONLY. You are never shown the candidate's face, voice, "
    "accent, tone or camera. Never infer emotion, confidence, warmth or "
    "composure, and never comment on body language.\n\n"
    "EVIDENCE RULE: every strength, improvement and red flag must be an object "
    "with point, quote and source. Copy 'quote' VERBATIM from the candidate's "
    "answer (source 'answer') or from their resume (source 'resume') - never "
    "paraphrase inside a quote and never invent one. If an observation cannot "
    "be tied to a verbatim quote, use source 'general' and set quote to an "
    "empty string.\n\n"
    "EVIDENCE-PRESERVING REVISION (answer_revision): rewrite the candidate's "
    "OWN answer using only their words and facts already present in their "
    "resume. You may reorder, tighten and signpost. Where a fact is missing, "
    "insert a bracketed placeholder the candidate must fill in themselves - "
    "[add metric], [clarify your role], [add timeframe], [name the tool]. "
    "NEVER invent a number, employer, tool, metric or outcome.\n\n"
    "Return ONLY JSON:\n"
    '{"breakdown": {"relevance_structure": 0, "specificity_evidence": 0, '
    '"impact_ownership": 0, "communication": 0, "self_awareness": 0},'
    ' "score": 0, "verdict": "one sentence overall judgement",'
    ' "strengths": [{"point": "observation", "quote": "verbatim words", '
    '"source": "answer|resume|general"}],'
    ' "improvements": [{"point": "specific fix", "quote": "verbatim words", '
    '"source": "answer|resume|general"}],'
    ' "red_flags": [{"point": "HR red flag", "quote": "verbatim words", '
    '"source": "answer|resume|general"}],'
    ' "hr_tip": "the real hiring principle behind this question and how to play '
    'it (e.g. they are testing ownership — say I, not we)",'
    ' "answer_revision": "the candidate\'s own answer, tightened, with '
    '[placeholders] where evidence is missing",'
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


# --------------------------------------------------------- evidence-cited output

_ELLIPSIS_RE = re.compile(r"(?:\.\.\.|\u2026)+")
_QUOTE_STRIP = "\"\u201c\u201d'`"


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _quote_in(quote: str, haystack: str) -> bool:
    """True when `quote` (or its longest fragment) appears verbatim in `haystack`.

    Tolerant of whitespace and surrounding quote marks, and of an ellipsis join
    ("first part ... second part"), but not of paraphrase: a fragment shorter
    than `MIN_FRAGMENT` characters is too weak to count as evidence.
    """
    if not quote or not haystack:
        return False
    hay = _normalise(haystack)
    needle = _normalise(quote).strip(_QUOTE_STRIP)
    if not needle:
        return False
    if needle in hay:
        return True
    fragments = [
        _normalise(f).strip(_QUOTE_STRIP)
        for f in _ELLIPSIS_RE.split(quote)
    ]
    fragments = [f for f in fragments if len(f) >= 12]
    return bool(fragments) and all(f in hay for f in fragments)


def _evidence(items, answer: str, resume: str) -> list[dict]:
    """Normalise model output into evidence items, verifying every quote.

    Aria never presents an unverifiable quote as evidence: if a claimed quote
    is not actually present in the answer or resume, it is dropped and the
    observation is re-labelled a general suggestion.
    """
    if isinstance(items, str):
        items = [items]
    elif not isinstance(items, list):
        items = []

    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        if isinstance(item, dict):
            point = str(
                item.get("point")
                or item.get("observation")
                or item.get("text")
                or ""
            ).strip()
            quote = str(item.get("quote") or item.get("evidence") or "").strip()
            source = str(item.get("source") or "").strip().lower()
        else:
            point, quote, source = str(item).strip(), "", ""

        if not point and not quote:
            continue
        if source not in ("answer", "resume", "general"):
            source = "answer" if quote else "general"

        verified = (
            _quote_in(quote, answer)
            if source == "answer"
            else _quote_in(quote, resume)
            if source == "resume"
            else False
        )
        if quote and not verified:
            quote = ""
            source = "general"

        key = (point.lower(), quote.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "point": point[:300],
                "quote": quote[:300],
                "source": source,
                "verified": verified,
            }
        )
        if len(out) >= 4:
            break
    return out


# ------------------------------------------------- job description grounding

_CONFIDENCE_ORDER = {"gap": 0, "unknown": 1, "partial": 2, "strong": 3}
_IMPORTANCE_ORDER = {"high": 0, "medium": 1, "low": 2}


def _coverage(jd: str, structured: dict, resume_text: str) -> dict:
    """Requirement x resume-evidence map. Evidence is verified verbatim."""
    payload = (
        f"JOB DESCRIPTION:\n{jd[:8000]}\n\n"
        "CANDIDATE RESUME FACTS (JSON):\n"
        f"{json.dumps(structured, ensure_ascii=False)[:6000]}\n\n"
        f"RAW RESUME TEXT:\n{resume_text[:4000]}"
    )
    result = _json_call(COVERAGE_SYSTEM, payload)

    requirements: list[dict] = []
    for raw in (result.get("requirements") or [])[:10]:
        if not isinstance(raw, dict):
            continue
        requirement = str(raw.get("requirement", "")).strip()
        if not requirement:
            continue
        evidence = str(raw.get("evidence", "")).strip()
        confidence = str(raw.get("confidence", "unknown")).strip().lower()
        importance = str(raw.get("importance", "medium")).strip().lower()
        if confidence not in _CONFIDENCE_ORDER:
            confidence = "unknown"
        if importance not in _IMPORTANCE_ORDER:
            importance = "medium"
        # A claimed match with no verifiable quote is not a match.
        if evidence and not _quote_in(evidence, resume_text):
            evidence = ""
        if not evidence and confidence in ("strong", "partial"):
            confidence = "gap"
        requirements.append(
            {
                "requirement": requirement[:240],
                "kind": str(raw.get("kind", "must_have")).strip().lower(),
                "evidence": evidence[:240],
                "confidence": confidence,
                "importance": importance,
                "why": str(raw.get("why", ""))[:200],
            }
        )
    return {
        "summary": str(result.get("summary", ""))[:400],
        "requirements": requirements,
        "gaps": sum(1 for r in requirements if r["confidence"] == "gap"),
        "matched": sum(
            1 for r in requirements if r["confidence"] in ("strong", "partial")
        ),
    }


def _focus_lines(coverage: dict) -> list[str]:
    """Bounded selection: the highest-importance gaps first, then partials."""
    requirements = (coverage or {}).get("requirements") or []
    ranked = sorted(
        requirements,
        key=lambda r: (
            _IMPORTANCE_ORDER.get(str(r.get("importance", "medium")), 1),
            _CONFIDENCE_ORDER.get(str(r.get("confidence", "unknown")), 1),
        ),
    )
    lines: list[str] = []
    for r in ranked[:6]:
        why = r.get("why") or "probe this requirement directly"
        lines.append(
            f"- [{r.get('importance', 'medium')} importance, "
            f"{str(r.get('confidence', 'unknown')).upper()}] "
            f"{r.get('requirement', '')} [{why}]"
        )
    return lines


def _weak_competencies(limit: int = 3) -> list[str]:
    """Competencies the candidate scored lowest on in previous sessions.

    Spaced re-asking, deliberately bounded. Retrieval practice is supported
    (Latimier 2021), but the transfer effect to a real interview is weaker than
    advertised (Corral 2025) — so this re-queues practice, it does not predict
    hiring outcomes, and it never touches the score.
    """
    try:
        return store.weak_competencies(threshold=60, limit=limit)
    except Exception as exc:  # noqa: BLE001 - history must never break practice
        print(f"  [store] could not read weak competencies: {exc}")
        return []


def _make_questions(structured: dict, text: str, coverage: dict) -> list[dict]:
    """Generate the question set, gap-driven when a JD map is present."""
    persona = PERSONAS[_state["persona"]]
    weak = _weak_competencies()
    weak_block = ""
    if weak:
        weak_block = (
            "SPACED PRACTICE — the candidate scored lowest on these "
            "competencies in previous sessions: "
            + ", ".join(weak)
            + ". Include at least one question that targets a weak "
            "competency, even when the resume looks strong there. This is "
            "practice scheduling from their own history, not a prediction.\n\n"
        )
    focus_lines = _focus_lines(coverage)
    focus = ""
    if focus_lines:
        focus = (
            "JOB-DESCRIPTION FOCUS (from the requirement/coverage map). Cover "
            "these first, one question each, probing the gap or asking for "
            "depth:\n"
            + "\n".join(focus_lines)
            + "\nThen fill any remaining questions with competencies from the "
            "resume.\n\n"
        )
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
        weak=weak_block,
        focus=focus,
    )
    result = _json_call(system, payload)

    questions: list[dict] = []
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
    return questions


def load_resume(
    filename: str,
    data: bytes,
    persona_id: str = DEFAULT_PERSONA,
    jd: str = "",
) -> dict:
    """Parse + structure the resume, then generate the tailored question set."""
    set_persona(persona_id)
    parsed = parsing.extract_document(filename, data)
    text = parsed["text"]
    if len(text) < 40:
        raise ValueError("could not read enough text from that file")

    structured = _json_call(EXTRACT_SYSTEM, text[:14000])
    jd = (jd or "").strip()
    coverage = _coverage(jd, structured, text) if jd else {}
    questions = _make_questions(structured, text, coverage)

    _state.update(
        filename=filename,
        resume=text,
        structured=structured,
        profile=str(structured.get("profile", "")),
        questions=questions,
        answers=[],
        parse=parsed,
        jd=jd,
        coverage=coverage,
    )
    _state["session_id"] = _start_session()
    return state()


def set_jd(jd: str) -> dict:
    """Ground the questions in a new job description (before answering)."""
    if not _state["resume"]:
        raise ValueError("upload a resume first")
    jd = (jd or "").strip()
    coverage = _coverage(jd, _state["structured"], _state["resume"]) if jd else {}
    _state.update(
        jd=jd,
        coverage=coverage,
        questions=_make_questions(_state["structured"], _state["resume"], coverage),
        answers=[],
    )
    return state()


def _score_question(question: dict, answer: str) -> dict:
    """Score one answer against the rubric. Never mutates session state."""
    persona = PERSONAS[_state["persona"]]
    payload = (
        f"CANDIDATE FACTS:\n{json.dumps(_state['structured'], ensure_ascii=False)[:5000]}\n\n"
        f"QUESTION ({question['type']}, competency: {question.get('competency', 'n/a')}):\n"
        f"{question['question']}\n\n"
        f"WHAT IT IS TESTING: {question.get('why', '')}\n\n"
        "CANDIDATE'S SPOKEN ANSWER (auto-transcribed; it may contain filler "
        f"words and transcription errors — judge the words as written):\n{answer}"
    )
    system = _fill(SCORE_SYSTEM, brief=persona["brief"])
    result = _json_call(system, payload)

    raw_breakdown = result.get("breakdown", {}) or {}
    breakdown = {
        dim: max(0, min(limit, int(raw_breakdown.get(dim, 0) or 0)))
        for dim, limit in DIMENSIONS.items()
    }
    # The score is the scorecard total. No persona arithmetic: the same answer
    # scores the same for every interviewer, so retries are comparable.
    score = sum(breakdown.values())  # 0-100
    # the spoken line is prefixed by us so it can never contradict the score
    spoken_body = str(result.get("spoken_feedback", "")).strip()
    spoken_feedback = f"Score {score} out of 100. {spoken_body}".strip()

    return {
        "question_id": int(question.get("id") or 0),
        "question": question["question"],
        "type": question["type"],
        "competency": question.get("competency", ""),
        "persona": _state["persona"],
        "answer": answer,
        "score": score,
        "raw_score": score,
        "breakdown": breakdown,
        "verdict": str(result.get("verdict", "")),
        "strengths": _evidence(result.get("strengths", []), answer, _state["resume"]),
        "improvements": _evidence(
            result.get("improvements", []), answer, _state["resume"]
        ),
        "red_flags": _evidence(
            result.get("red_flags", []), answer, _state["resume"]
        ),
        "hr_tip": str(result.get("hr_tip", "")),
        "answer_revision": str(result.get("answer_revision", "")),
        "spoken_feedback": spoken_feedback,
        "setup": None,
        # "voice" when it came from the mic (so the transcript can be corrected
        # afterwards), "typed" when the candidate wrote it
        "source": "typed",
        "edited": False,
    }


def _record_setup(question: dict, setup: dict | None) -> None:
    """Record a camera-setup window for the session summary (never scored)."""
    if not setup:
        return
    _state["setup"].append(
        {
            "question": question["question"],
            "metrics": setup,
            "notes": [str(n) for n in setup.get("notes", [])][:4],
        }
    )


def _next_attempt(question_id: int) -> int:
    """Number of prior attempts for this question in this session, plus one."""
    try:
        done = store.attempts_for(_state.get("session_id"), question_id)
    except Exception as exc:  # noqa: BLE001 - history must never break practice
        print(f"  [store] could not count attempts: {exc}")
        done = 0
    return max(1, done) + 1


# ------------------------------------------------------ retry / what changed

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'%$.-]*")
_NUMBER_RE = re.compile(r"\d[\d,.]*\s?%?")


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _number_tokens(text: str) -> list[str]:
    return [re.sub(r"\s+", "", m) for m in _NUMBER_RE.findall(text or "")]


def _answer_diff(before: str, after: str) -> dict:
    """Deterministic word-level comparison: what this attempt added or dropped.

    This is arithmetic on the two transcripts, not a model's opinion, so it is
    reproducible and can never invent an addition that is not there.
    """
    from collections import Counter

    bt, at = _tokens(before), _tokens(after)
    bc, ac = Counter(bt), Counter(at)
    added_counts, removed_counts = ac - bc, bc - ac

    added: list[str] = []
    removed: list[str] = []
    seen: set[str] = set()
    for token in at:
        if added_counts.get(token, 0) > 0 and token not in seen:
            seen.add(token)
            added.append(token)
    seen = set()
    for token in bt:
        if removed_counts.get(token, 0) > 0 and token not in seen:
            seen.add(token)
            removed.append(token)

    nb, na = _number_tokens(before), _number_tokens(after)
    numbers_added: list[str] = []
    seen = set()
    for number in na:
        if number not in nb and number not in seen:
            seen.add(number)
            numbers_added.append(number)

    return {
        "added_words": added[:30],
        "removed_words": removed[:30],
        "numbers_added": numbers_added[:12],
        "word_count_before": len(bt),
        "word_count_after": len(at),
    }


def _retry_diff(before: dict, after: dict, attempt: int) -> dict:
    """Side-by-side comparison of a retry against the previous attempt."""
    before_breakdown = before.get("breakdown", {}) or {}
    after_breakdown = after.get("breakdown", {}) or {}
    dimensions = []
    for key, limit in DIMENSIONS.items():
        b = int(before_breakdown.get(key, 0) or 0)
        a = int(after_breakdown.get(key, 0) or 0)
        dimensions.append(
            {"key": key, "max": limit, "before": b, "after": a, "delta": a - b}
        )
    score_before = int(before.get("score", 0) or 0)
    score_after = int(after.get("score", 0) or 0)
    text = _answer_diff(before.get("answer", ""), after.get("answer", ""))
    delta = score_after - score_before
    bits = [f"Attempt {attempt}: {score_before} → {score_after} ({delta:+d})."]
    if text["numbers_added"]:
        bits.append(
            f"You added {len(text['numbers_added'])} concrete number(s) this time."
        )
    bits.append(
        f"Answer length {text['word_count_before']} → "
        f"{text['word_count_after']} words."
    )
    return {
        "attempt": attempt,
        "score_before": score_before,
        "score_after": score_after,
        "score_delta": delta,
        "dimensions": dimensions,
        "summary": " ".join(bits),
        **text,
    }


def score_answer(
    answer: str,
    setup: dict | None = None,
    edited: bool = False,
    source: str = "typed",
) -> dict:
    """Score the candidate's answer to the current question.

    Scored immediately on the transcript exactly as transcribed - the candidate
    is never blocked by a confirm step. `setup` is the local camera-setup
    summary, recorded for the rehearsal panel and NEVER entering the score:
    Aria does not judge a face (EU AI Act Art. 5(1)(f)). `edited` marks an
    answer whose transcript was later corrected via :func:`rescore_answer`.
    """
    question = current_question()
    if question is None:
        raise ValueError("no current question — upload a resume first")
    record = _score_question(question, answer)
    record["setup"] = setup
    record["source"] = "voice" if source == "voice" else "typed"
    _state["answers"].append(record)
    _persist_answer(question, record, attempt=1, edited=edited)
    _record_setup(question, setup)
    return {**record, "next_question": current_question(), "state": state()}


def rescore_answer(question_id: int, answer: str) -> dict:
    """Re-score an answer after the candidate corrected the transcript.

    This replaces the same attempt rather than adding one. A correction is not
    a retry, so it must not inflate the "retried" behaviour counter, add an
    attempt to the history, or drag the competency average down with the score
    the microphone produced by mistake.
    """
    try:
        qid = int(question_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid question id") from exc
    question = next(
        (q for q in _state["questions"] if int(q.get("id") or 0) == qid), None
    )
    if question is None:
        raise ValueError("unknown question")
    index = next(
        (
            i
            for i, r in enumerate(_state["answers"])
            if int(r.get("question_id") or 0) == qid
        ),
        None,
    )
    if index is None:
        raise ValueError("no answer to re-score for that question")

    before = _state["answers"][index]
    record = _score_question(question, answer)
    record["setup"] = before.get("setup")
    record["source"] = "voice"
    record["edited"] = True
    record["rescored"] = True
    _state["answers"][index] = record

    row_id = (_state.get("answer_rows") or {}).get(qid)
    if row_id:
        try:
            store.update_answer(row_id, record)
        except Exception as exc:  # noqa: BLE001
            print(f"  [store] could not update the corrected answer: {exc}")

    score_before = int(before.get("score", 0) or 0)
    return {
        **record,
        "score_before": score_before,
        "score_delta": record["score"] - score_before,
        "next_question": current_question(),
        "state": state(),
    }


def retry_answer(
    question_id: int,
    answer: str,
    setup: dict | None = None,
    edited: bool = False,
) -> dict:
    """Score a second attempt at an already-answered question.

    A retry is deliberately out-of-band: it does not advance the question
    sequence and does not overwrite the first attempt. It is scored against
    the same rubric and stored as the next attempt in the local history, so
    the behaviour record shows a genuine retry, and it returns a deterministic
    diff of what changed between the two answers.
    """
    try:
        qid = int(question_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid question id") from exc
    question = next(
        (q for q in _state["questions"] if int(q.get("id") or 0) == qid), None
    )
    if question is None:
        raise ValueError("unknown question for retry")
    before = next(
        (r for r in _state["answers"] if int(r.get("question_id") or 0) == qid),
        None,
    )
    if before is None:
        raise ValueError("answer this question once before retrying it")

    record = _score_question(question, answer)
    record["setup"] = setup
    attempt = _next_attempt(qid)
    _persist_answer(question, record, attempt=attempt, edited=edited)
    _record_setup(question, setup)
    return {
        **record,
        "attempt": attempt,
        "diff": _retry_diff(before, record, attempt),
        "behaviour": _behaviour(),
    }
