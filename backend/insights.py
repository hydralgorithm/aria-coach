"""Resume claims, strengths/weaknesses/opportunities, readiness and learning plans.

This module is the personalisation core that ties the product together:

1. **Claim extraction** — find the quantified, checkable claims in a resume
   ("reduced latency by 40%") so the interview can interrogate them and the
   learning plan can demand evidence for them.
2. **Strengths / Weaknesses / Opportunities report** — the explicit
   evidence-cited report the problem statement asks for, not just "probe areas".
3. **Readiness profile** — an explainable practice-readiness picture built ONLY
   from stored evidence: JD coverage, interview competencies, communication
   delivery and resume parse robustness. Never a hiring prediction.
4. **Learning plan** — gap-driven: each item names the JD requirement it comes
   from, the evidence (or its absence), why it matters, a verified resource,
   a practice task, a mini drill, and the re-test that closes the loop.

Every generated item carries a `provenance` label:
  verified_resume  — quoted verbatim from the resume
  measured         — computed from the candidate's own stored attempts
  general          — advice not tied to a specific verified fact

Aria never converts an inference into a fact: nothing here invents metrics,
employers or skills the candidate has not shown.
"""

from __future__ import annotations

import json
import re

from . import store

# Bounded scans. These are NOT the interview length (coach.INTERVIEW_LENGTH) —
# naming them separately is the point: one stray "6" must never be ambiguous
# about which product decision it encodes.
MAX_ROLES_SCANNED = 5
MAX_HIGHLIGHTS_SCANNED = 6
MAX_PLAN_ITEMS = 6

# --------------------------------------------------------------- claim probe

# A resume claim with a number in it ("reduced latency by 40%", "cut costs 2x").
# The unit must be followed by a boundary (space/punct/end) — % and currency
# symbols are not word characters, so \b would fail after them.
_CLAIM_RE = re.compile(
    r"([^.!\n]{10,220}?)\b(\d[\d,.]*\s?(?:%|percent|x|k|m|bn|billion|million|"
    r"ms|hours?|days?|weeks?|months?|years?|users|customers|requests?|"
    r"tickets?|orders?|₹[\d,.]+|\$[\d,.]+|€[\d,.]+|£[\d,.]+)"
    r"(?=[\s,;:.!?]|$)[^.!\n]{0,120})",
    re.IGNORECASE,
)

# The kind of probe a real interviewer runs on each claim shape.
_PROBE_TEMPLATES: list[tuple[str, list[str]]] = [
    (r"\b(?:reduc|cut|decreas|lower|drove|improv|increas|boost|grow)", [
        "How was that measured, and what was the baseline?",
        "What was the bottleneck before the change?",
        "What did you personally change, and what trade-off did that create?",
    ]),
    (r"\b(?:migrat|rewrit|rebuil|implement|architect|design|built|develop)", [
        "Why was it built that way — what alternatives did you reject?",
        "What broke during the rollout, and how did you handle it?",
        "What would you do differently if you rebuilt it today?",
    ]),
    (r"\b(?:led|manag|own|mentored|coordinat|organiz|organis)", [
        "What was the hardest decision that was yours alone?",
        "How did you divide the work, and how did you know it was done?",
        "Tell me about a person you had to bring along who resisted.",
    ]),
    (r"\b(?:automat|optimi|scale|deploy|ci|cd|test)", [
        "What did the pipeline look like before and after?",
        "What failed the first time you ran it at scale?",
        "How is it monitored in production?",
    ]),
]

_FALLBACK_PROBES = [
    "Walk me through exactly how you measured that.",
    "What was your personal contribution versus the team's?",
    "What trade-off did that number cost you?",
]


def extract_claims(resume_text: str, limit: int = 4) -> list[dict]:
    """Quantified, checkable claims from the resume, each with probes."""
    claims: list[dict] = []
    seen: set[str] = set()
    for m in _CLAIM_RE.finditer(resume_text or ""):
        sentence = f"{m.group(1).strip()} {m.group(2).strip()}".strip()
        # a currency symbol lands in the prefix when the match starts at the
        # digit: "$1.2M" -> "$ 1.2M" — glue it back
        sentence = re.sub(r"([₹$€£])\s+(?=\d)", r"\1", sentence)
        sentence = re.sub(r"\s+", " ", sentence)
        if len(sentence) < 20 or sentence.lower() in seen:
            continue
        seen.add(sentence.lower())
        probes = _FALLBACK_PROBES
        for pattern, probe_list in _PROBE_TEMPLATES:
            if re.search(pattern, sentence, re.IGNORECASE):
                probes = probe_list
                break
        claims.append(
            {
                "claim": sentence[:300],
                "quote": sentence[:300],
                "source": "verified_resume",
                "probes": probes[:3],
            }
        )
        if len(claims) >= limit:
            break
    return claims


# --------------------------------------------- strengths / weak / opportunity

def build_sow_report(
    structured: dict, resume_text: str, coverage: dict, answers: list
) -> dict:
    """Explicit Strengths / Weaknesses / Opportunities, every item evidenced.

    Strengths quote verified resume lines. Weaknesses name what the evidence
    does NOT show (thin quantification, missing sections, interview weaknesses
    measured from real attempts). Opportunities propose how to strengthen a
    claim only if the underlying facts exist — placeholders like [add metric],
    never invented numbers.
    """
    strengths: list[dict] = []
    weaknesses: list[dict] = []
    opportunities: list[dict] = []

    # --- strengths: quantified achievements the resume actually contains
    claims = extract_claims(resume_text, limit=3)
    for c in claims:
        strengths.append(
            {
                "point": f"Quantified impact: {_trim(c['claim'], 140)}",
                "quote": c["quote"],
                "source": "verified_resume",
            }
        )
    skills = [str(s) for s in (structured.get("skills") or [])][:4]
    if skills:
        strengths.append(
            {
                "point": "Focused skill set the resume states outright",
                "quote": ", ".join(skills),
                "source": "verified_resume",
            }
        )
    achievements = [str(a) for a in (structured.get("top_achievements") or [])][:2]
    for a in achievements:
        strengths.append(
            {
                "point": "Flagged as a top achievement in its own words",
                "quote": _trim(a, 200),
                "source": "verified_resume",
            }
        )
    if not strengths:
        strengths.append(
            {
                "point": "Resume parsed cleanly enough to build an interview from",
                "quote": _trim((resume_text or "")[:160], 160),
                "source": "verified_resume",
            }
        )

    # --- weaknesses: unquantified project bullets, thin evidence, measured gaps
    experience = structured.get("experience") or []
    unquantified: list[str] = []
    for exp in experience[:MAX_ROLES_SCANNED]:
        for h in (exp.get("highlights") or [])[:MAX_HIGHLIGHTS_SCANNED]:
            h = str(h).strip()
            if h and not re.search(r"\d", h):
                unquantified.append(h)
    if unquantified:
        weaknesses.append(
            {
                "point": (
                    f"{len(unquantified)} project/experience bullet(s) contain no "
                    "measurable outcome, so their impact cannot be verified"
                ),
                "quote": _trim(unquantified[0], 180),
                "source": "verified_resume",
            }
        )
        opportunities.append(
            {
                "point": (
                    "Quantify a bullet ONLY where the fact genuinely exists — "
                    "users served, test coverage, latency before/after, team size"
                ),
                "example": _trim(unquantified[0], 120),
                "rewrite": f"{_trim(unquantified[0], 100)} [add metric]",
                "source": "verified_resume",
            }
        )

    # JD gaps measured against the resume
    for req in ((coverage or {}).get("requirements") or []):
        if req.get("confidence") == "gap" and req.get("importance") == "high":
            weaknesses.append(
                {
                    "point": f"High-importance JD requirement with no resume evidence: {req.get('requirement', '')}",
                    "quote": str(req.get("requirement", ""))[:180],
                    "source": "measured",
                }
            )
            opportunities.append(
                {
                    "point": (
                        f"Build one small, real project using {req.get('requirement', '')} "
                        "before the interview — then the resume can state it truthfully"
                    ),
                    "source": "general",
                }
            )
            break  # one is enough; the gap map shows the rest

    # Interview-measured weaknesses (from the candidate's own attempts)
    weak_comps = [
        {
            "competency": h["competency"],
            "avg": h["avg_score"],
            "attempts": h["attempts"],
        }
        for h in _competency_history()
        if h["avg_score"] < 60 and h["attempts"] >= 1
    ][:3]
    for w in weak_comps:
        weaknesses.append(
            {
                "point": (
                    f"Interview practice averages {w['avg']}/100 on "
                    f"{w['competency']} across {w['attempts']} attempt(s)"
                ),
                "quote": "",
                "source": "measured",
                "competency": w["competency"],
            }
        )

    if not weaknesses:
        weaknesses.append(
            {
                "point": (
                    "No quantified-impact gap detected in this pass — have a human "
                    "review the claims before you rely on them"
                ),
                "quote": "",
                "source": "general",
            }
        )

    return {
        "strengths": strengths[:5],
        "weaknesses": weaknesses[:5],
        "opportunities": opportunities[:4],
        "claims": claims,
        "provenance_note": (
            "verified_resume = quoted verbatim from your resume; measured = "
            "computed from your stored practice attempts; general = advice not "
            "tied to a specific fact. Nothing here invents a metric."
        ),
    }


def _competency_history() -> list[dict]:
    try:
        return store.competency_history()
    except Exception:  # noqa: BLE001 - history is optional infrastructure
        return []


# ----------------------------------------------------------------- readiness

READINESS_PARTS = [
    # key, label, weight — weights sum to 100
    ("jd_coverage", "JD skill coverage", 25),
    ("technical", "Technical knowledge (practice)", 20),
    ("behavioral", "Behavioral structure (practice)", 20),
    ("communication", "Communication delivery", 15),
    ("evidence", "Evidence & specificity", 10),
    ("resume_robustness", "Resume parser robustness", 10),
]


def build_readiness(coverage: dict, answers: list, parse: dict) -> dict:
    """Explainable interview-readiness profile from stored evidence only.

    Each component is computed from something checkable: the JD coverage map,
    the candidate's own practice attempts, deterministic delivery metrics, and
    the resume parse audit. The total is a *practice readiness* number, never a
    hiring prediction — that limit is printed next to the number itself.
    """
    # 1. JD coverage: strong=1.0 partial=0.5 gap/unknown=0, importance-weighted
    reqs = (coverage or {}).get("requirements") or []
    if reqs:
        weight_map = {"high": 3, "medium": 2, "low": 1}
        total_w = 0.0
        got_w = 0.0
        for r in reqs:
            w = weight_map.get(str(r.get("importance", "medium")), 2)
            total_w += w
            conf = str(r.get("confidence", "unknown"))
            got_w += w * {"strong": 1.0, "partial": 0.5}.get(conf, 0.0)
        jd_score = round(100 * got_w / total_w) if total_w else None
    else:
        jd_score = None

    # 2/3. Technical & behavioral from the candidate's own scored attempts
    by_type: dict[str, list[int]] = {}
    for a in answers:
        qtype = str(a.get("type") or "behavioral")
        by_type.setdefault("technical" if "tech" in qtype else "behavioral", []).append(
            int(a.get("score") or 0)
        )
    def _avg(values: list[int]) -> int | None:
        return round(sum(values) / len(values)) if values else None
    technical = _avg(by_type.get("technical", []))
    behavioral = _avg(by_type.get("behavioral", []))

    # No practice answers this session? Fall back to stored history averages.
    if technical is None or behavioral is None:
        history = _competency_history()
        hist_scores = [h["avg_score"] for h in history if h.get("attempts")]
        if technical is None and hist_scores:
            technical = round(sum(hist_scores) / len(hist_scores))
        if behavioral is None and hist_scores:
            behavioral = round(sum(hist_scores) / len(hist_scores))

    # 4/5. Communication & evidence: deterministic delivery metrics + breakdowns
    speech_vals = [
        a.get("speech") for a in answers if isinstance(a.get("speech"), dict)
    ]
    comm_parts: list[float] = []
    for s in speech_vals:
        score = 100.0
        fillers = s.get("fillers_per_100_words") or 0
        if fillers > 8:
            score -= 25
        elif fillers > 4:
            score -= 12
        wpm = s.get("wpm")
        if wpm:
            if wpm > 190 or wpm < 100:
                score -= 15
        if s.get("restarts"):
            score -= min(10, 5 * int(s["restarts"]))
        comm_parts.append(max(0.0, score))
    communication = _avg([round(v) for v in comm_parts]) if comm_parts else None

    ev_parts: list[float] = []
    for a in answers:
        b = a.get("breakdown") or {}
        if isinstance(b, dict) and b.get("specificity_evidence") is not None:
            ev_parts.append(100.0 * float(b["specificity_evidence"]) / 25.0)
    evidence = _avg([round(v) for v in ev_parts]) if ev_parts else None

    # 6. Resume parser robustness from the deterministic audit
    audit = (parse or {}).get("audit") or {}
    rob = 100.0
    for f in audit.get("flags") or []:
        sev = str(f.get("severity", ""))
        rob -= {"high": 18, "medium": 8, "low": 3}.get(sev, 0)
    if not audit:
        rob = 0.0  # nothing verified: unknown, not good
    resume_robustness = int(max(0, min(100, rob)))

    components = {
        "jd_coverage": jd_score,
        "technical": technical,
        "behavioral": behavioral,
        "communication": communication,
        "evidence": evidence,
        "resume_robustness": resume_robustness,
    }

    total = 0.0
    total_w = 0.0
    details = []
    for key, label, weight in READINESS_PARTS:
        value = components.get(key)
        if value is None:
            # A component with no evidence is reported, not guessed.
            details.append(
                {
                    "key": key,
                    "label": label,
                    "value": None,
                    "weight": weight,
                    "note": "no evidence yet — answer a question or add a JD",
                }
            )
            continue
        total += value * weight
        total_w += weight
        details.append({"key": key, "label": label, "value": value, "weight": weight})
    overall = round(total / total_w) if total_w else 0

    return {
        "overall": overall,
        "components": details,
        "scale_note": (
            "Interview practice readiness (0-100), computed only from the "
            "components shown. Not an ATS score, not a hiring prediction."
        ),
        "missing_components": [d["label"] for d in details if d["value"] is None],
    }


# ------------------------------------------------------------- learning plan

def build_learning_plan(coverage: dict, sow: dict, claims: list) -> dict:
    """Gap-driven, resource-backed preparation plan.

    Every item traces to an identified gap: a JD requirement the resume does not
    evidence, an unquantified resume claim the interview could not support, or a
    competency the candidate's own attempts scored below the bar (read from the
    local history, which already includes this session's answers). Resources
    come from a curated, verification-friendly catalog — the model never
    invents a URL.
    """
    from .resources import recommend_for

    items: list[dict] = []
    seen_topics: set[str] = set()

    def _add(topic: str, reason: str, evidence: str, origin: str, priority: str) -> None:
        key = topic.strip().lower()
        if not key or key in seen_topics:
            return
        seen_topics.add(key)
        rec = recommend_for(topic)
        items.append(
            {
                "topic": topic,
                "priority": priority,
                "why": reason,
                "evidence": evidence[:200],
                "origin": origin,  # jd_gap | weak_competency | unsupported_claim
                "resource": rec,
                "practice_task": _practice_task(topic, origin),
                "mini_drill": _mini_drill(topic),
                "retest": (
                    f"Re-answer the {topic} interview question in a new session — "
                    "the readiness component updates from your new attempt"
                ),
                "estimated_effort": rec.get("estimated_time", "45 minutes"),
            }
        )

    # 1. High-importance JD gaps first
    for req in ((coverage or {}).get("requirements") or []):
        if req.get("confidence") in ("gap", "unknown") and req.get("requirement"):
            importance = str(req.get("importance", "medium"))
            priority = {"high": "critical", "medium": "important"}.get(
                importance, "optional"
            )
            if priority == "optional":
                continue
            _add(
                _topic_from_requirement(str(req.get("requirement", ""))),
                (
                    f"the job description lists '{req.get('requirement', '')}' as "
                    f"{importance} importance, and your resume shows no evidence of it"
                ),
                str(req.get("requirement", "")),
                "jd_gap",
                priority,
            )
        if len(items) >= 4:
            break

    # 2. Competencies the candidate's own attempts scored low
    for h in _competency_history():
        if h["avg_score"] >= 65 or h["attempts"] < 1:
            continue
        if len(items) >= 6:
            break
        _add(
            f"{h['competency']} interview technique",
            (
                f"your practice attempts average {h['avg_score']}/100 on "
                f"{h['competency']} across {h['attempts']} attempt(s)"
            ),
            f"competency history: {h['competency']} avg {h['avg_score']}",
            "weak_competency",
            "important",
        )

    # 3. Resume claims the interview could not support
    for c in (sow.get("claims") or claims)[:2]:
        _add(
            "answering quantitative follow-ups",
            (
                "your resume claims a quantified result; interviewers probe how it "
                "was measured — rehearse the baseline, the change and the trade-off"
            ),
            c.get("claim", "")[:180],
            "unsupported_claim",
            "important",
        )

    if not items:
        items.append(
            {
                "topic": "mock interview under realistic pressure",
                "priority": "important",
                "why": (
                    "no specific gaps identified yet — run a full interview with a "
                    "persona and a JD, and the plan will re-form around what it finds"
                ),
                "evidence": "",
                "origin": "general",
                "resource": recommend_for("interview practice"),
                "practice_task": (
                    "Run one full session with a JD pasted, then read this plan "
                    "again — it rebuilds from the new evidence"
                ),
                "mini_drill": "Re-answer your weakest question once via Retry",
                "retest": "Check the readiness panel after the session",
                "estimated_effort": "20 minutes",
            }
        )

    return {
        "items": items[:MAX_PLAN_ITEMS],
        "method_note": (
            "Generated from your own gaps: JD requirements without evidence, "
            "competencies your attempts scored low, and resume claims that need "
            "an answer. Resources come from a fixed, curated catalog — never an "
            "invented URL."
        ),
    }


def _topic_from_requirement(requirement: str) -> str:
    r = requirement.strip().lower()
    # Trim to a study topic: drop boilerplate like "experience with", "knowledge of"
    r = re.sub(r"^(?:experience with|knowledge of|familiarity with|strong)\s+", "", r)
    r = re.sub(r"\s*\(.*?\)\s*", " ", r)
    return r.strip(" .,-") or requirement.strip()


def _practice_task(topic: str, origin: str) -> str:
    if origin == "weak_competency":
        return (
            f"Write a STAR answer for one real {topic} story, then speak it twice: "
            "once for structure, once cutting every filler word"
        )
    if origin == "unsupported_claim":
        return (
            "For each quantified claim on your resume, write down: the baseline, "
            "how it was measured, what you changed, and the trade-off"
        )
    return (
        f"Build one small, real artifact with {topic} (a working snippet or a "
        "one-page design note) — then it belongs on the resume truthfully"
    )


def _mini_drill(topic: str) -> str:
    return (
        f"Answer these out loud, 60 seconds each: (1) When would {topic} be the "
        f"wrong choice? (2) What breaks first at 10x scale? (3) How would you "
        "debug it failing in production?"
    )


def _trim(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def serialize_plan(plan: dict) -> str:
    return json.dumps(plan, ensure_ascii=False, indent=2)
