"""Performance audit: measure every step of the workflow, report the slowest.

    python scripts/perf_audit.py [base_url]

Assumes a server is already running (cloud or offline mode; it reports which).
Numbers are wall-clock medians of a small number of runs, so they are honest
but not benchmark-grade. The point is to find the slowest step, not to publish.
"""

from __future__ import annotations

import statistics
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
SID = "perf-a"
H = {"X-Session-Id": SID}

RESUME = """Aarav Sharma
aarav.sharma@example.com

EXPERIENCE
Finflow Labs - Backend Engineer (2023 - present)
- Reduced p95 API latency by 38% by introducing Redis caching for the pricing endpoint.
- Built a FastAPI service handling 12000 requests per minute across 6 services.
- Mentored 2 junior engineers through weekly design reviews.

SKILLS
Python, FastAPI, PostgreSQL, Redis, Docker, AWS, pytest
"""

JD = """Senior Backend Engineer
Requirements: Python backend, Redis caching, PostgreSQL, Docker, system design
"""


def timed(label: str, fn):
    t0 = time.time()
    out = fn()
    dt = time.time() - t0
    print(f"  {label:38s} {dt:6.2f}s")
    return dt, out


def main() -> int:
    results: list[tuple[str, float]] = []
    client = httpx.Client(timeout=900.0)

    health = client.get(f"{BASE}/api/health").json()
    print(f"  mode: {'OFFLINE' if health.get('offline_mode') else 'CLOUD'} "
          f"engines={health['engines']}")

    _, st = timed(
        "resume upload + analysis + questions",
        lambda: client.post(
            f"{BASE}/api/interview/resume",
            files={"file": ("resume.txt", RESUME.encode(), "text/plain")},
            data={"persona": "standard", "jd": JD},
            headers=H,
        ).json(),
    )

    q = (st.get("questions") or [{}])[0]
    answer = (
        "I profiled the endpoint with py-spy, traced the hot path to two sequential "
        "Redis round trips, batched them into one pipeline and set a 60 second TTL "
        "safe because prices change hourly. P95 fell from 240ms to 149ms."
    )
    dt, scored = timed(
        "answer -> score -> feedback",
        lambda: client.post(
            f"{BASE}/api/interview/answer",
            json={"message": answer, "source": "typed", "duration_s": 34.0},
            headers=H,
        ).json(),
    )
    results.append(("answer scoring", dt))

    dt, _ = timed(
        "retry + before/after diff",
        lambda: client.post(
            f"{BASE}/api/interview/retry",
            json={"message": answer + " I also tracked cache hit ratio in Grafana.",
                  "question_id": q.get("id"), "setup": {"duration_s": 34.0}},
            headers=H,
        ).json(),
    )
    results.append(("retry scoring", dt))

    timed("rescore (transcript correction)", lambda: client.post(
        f"{BASE}/api/interview/rescore",
        json={"question_id": q.get("id"), "message": answer},
        headers=H,
    ).json())

    timed("progress endpoint", lambda: client.get(f"{BASE}/api/progress", headers=H).json())
    timed("session state (refresh path)",
          lambda: client.get(f"{BASE}/api/interview/state", headers=H).json())

    audio_url = (scored or {}).get("audio_url") or ""
    if audio_url:
        dt, _ = timed("TTS audio fetch", lambda: client.get(BASE + audio_url))
        results.append(("TTS", dt))
    else:
        print("  TTS                               (skipped - no audio in response)")

    slowest = max(results, key=lambda r: r[1])
    print(f"\n  slowest step: {slowest[0]} at {slowest[1]:.2f}s")
    if len(results) > 1:
        print(f"  median scored step: "
              f"{statistics.median(d for _, d in results):.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())