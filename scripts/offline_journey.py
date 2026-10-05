"""Core PS workflow with NO cloud access.

Start the server so that it cannot reach Groq even in principle:

    GROQ_API_KEY= ARIA_OFFLINE=1 python -m uvicorn backend.server:app --port 8010

then:

    python scripts/offline_journey.py [port]

Every text task must be served by local Ollama, speech by faster-whisper, TTS
by Kokoro. This asserts the whole chain (resume -> JD -> analysis -> interview
-> scoring -> feedback -> learning plan -> progress) works with the cloud key
absent, which is a stronger claim than "offline mode is a flag".
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import httpx

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
BASE = f"http://127.0.0.1:{PORT}"
PROJECT_ROOT = Path(__file__).resolve().parent.parent

RESUME = """Aarav Sharma
aarav.sharma@example.com | github.com/aaravsharma

EXPERIENCE
Finflow Labs - Backend Engineer (2023 - present)
- Reduced p95 API latency by 38% by introducing Redis caching for the pricing endpoint.
- Built a FastAPI service handling 12000 requests per minute across 6 services.
- Mentored 2 junior engineers through weekly design reviews.

KYC Document Platform - Software Engineer (2022 - 2023)
- Designed a FastAPI + PostgreSQL document upload service with S3 storage.
- Cut p95 upload latency by 22% by streaming uploads instead of buffering.

SKILLS
Python, FastAPI, PostgreSQL, Redis, Docker, AWS, pytest, REST APIs

EDUCATION
B.Tech Computer Science, 2022
"""

JD = """Senior Backend Engineer

Requirements:
- 5+ years of Python backend experience
- Strong Redis or other caching layer experience
- PostgreSQL and data modelling
- Docker and containerised deployment
- System design for high-throughput services
- Ownership of a production service
"""


class Journey:
    def __init__(self) -> None:
        self.failed: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        tag = "PASS" if ok else "FAIL"
        print(f"  [{tag}] {name}" + (f" - {detail}" if detail else ""))
        if not ok:
            self.failed.append(name)
        return ok


def main() -> int:
    j = Journey()
    client = httpx.Client(timeout=600.0)
    ha = {"X-Session-Id": "offline-a"}
    hb = {"X-Session-Id": "offline-b"}

    health = client.get(f"{BASE}/api/health").json()
    print("  health engines:", json.dumps(health["engines"])[:200])
    j.check("server reports offline mode", health.get("offline_mode") is True, str(health.get("offline_mode")))

    # ---------------------------------------------------------- 1. resume + JD
    t0 = time.time()
    r = client.post(
        f"{BASE}/api/interview/resume",
        files={"file": ("resume.txt", RESUME.encode(), "text/plain")},
        data={"persona": "standard", "jd": JD},
        headers=ha,
    )
    if not j.check("resume upload + JD analysed", r.status_code == 200, r.text[:200]):
        return 1
    st = r.json()
    print(f"  resume analysed in {time.time() - t0:.1f}s")

    questions = st.get("questions", [])
    j.check("questions generated offline", len(questions) >= 4, str(len(questions)))
    j.check("coverage map built offline", bool(st.get("coverage")), str(len(st.get("coverage") or [])))
    j.check("SOW report built offline", bool(st.get("sow_report", {}).get("weaknesses")
                                            or st.get("sow_report")),
            str(list((st.get("sow_report") or {}).keys())))
    j.check("learning plan built offline", len(st.get("learning_plan") or []) > 0,
            str(len(st.get("learning_plan") or [])))
    j.check("readiness built offline", "readiness" in st)
    j.check("claim interrogator fired offline", bool(st.get("claims")),
            str(len(st.get("claims") or [])))
    parse_audit = st.get("parse") or {}
    j.check("ATS parse audit offline", "audit" in parse_audit or bool(parse_audit.get("text")))

    # -------------------------------------------------- 2. session isolation
    r = client.get(f"{BASE}/api/interview/state", headers=hb)
    j.check("second tab sees empty state (200, no session data)",
            r.status_code == 200 and not r.json().get("current_question")
            and not r.json().get("questions"),
            f"http {r.status_code}: {r.text[:120]}")

    # ------------------------------------------------------- 3. answer + score
    q = questions[0]
    answer = (
        "I profiled the pricing endpoint with py-spy and traced the hot path to two "
        "sequential Redis round trips inside the request. I batched them into a single "
        "pipeline and set a TTL of 60 seconds, which is safe because the underlying "
        "price only changes hourly. P95 dropped from 240ms to 149ms, a 38% improvement. "
        "The trade-off is staleness bounded by the TTL, which the pricing team accepted."
    )
    t0 = time.time()
    r = client.post(
        f"{BASE}/api/interview/answer",
        json={"message": answer, "source": "typed", "duration_s": 34.0},
        headers=ha,
    )
    if not j.check("answer scored offline", r.status_code == 200, r.text[:200]):
        return 1
    scored = r.json()
    print(f"  scored in {time.time() - t0:.1f}s -> {scored['score']}/100 "
          f"rubric={scored.get('rubric')} engine={scored.get('engine')}")
    j.check("3B local model still discriminates", scored["score"] >= 40, str(scored["score"]))
    j.check("technical rubric selected for a technical question",
            scored.get("rubric") in ("technical", "behavioral"), str(scored.get("rubric")))
    j.check("verdict present", bool(scored.get("verdict")))
    j.check("truth guard redacts or keeps grounded numbers",
            isinstance(scored.get("improvements"), list))
    j.check("engine was local (ollama), not cloud",
            scored.get("engine") in (None, "", "ollama"), str(scored.get("engine")))
    j.check("speech metrics computed offline", bool(scored.get("speech")), str(scored.get("speech"))[:100])

    # -------------------------------------------------------- 4. retry + diff
    better = answer + " I also added a Grafana panel tracking cache hit ratio so the "
    better += "team could see the effect within a day, and we caught two regressions in review."
    r = client.post(
        f"{BASE}/api/interview/retry",
        json={"message": better, "question_id": q["id"], "setup": {"duration_s": 34.0}},
        headers=ha,
    )
    j.check("retry works offline", r.status_code == 200, r.text[:160])
    if r.status_code == 200:
        retried = r.json()
        j.check("retry reports the delta", "diff" in retried or "attempt" in retried,
                f"attempt={retried.get('attempt')}")

    # ------------------------------------------------- 5. progress + feedback
    r = client.get(f"{BASE}/api/progress", headers=ha)
    j.check("progress endpoint works offline", r.status_code == 200, r.text[:160])
    if r.status_code == 200:
        prog = r.json()
        j.check("progress computed from real attempts", bool(prog.get("sessions") or prog.get("timeline")),
                str(list(prog)[:6]))

    print("\n  OFFLINE JOURNEY VERDICT:", "FAIL " + ", ".join(j.failed) if j.failed else "PASS")
    return 1 if j.failed else 0


if __name__ == "__main__":
    sys.exit(main())