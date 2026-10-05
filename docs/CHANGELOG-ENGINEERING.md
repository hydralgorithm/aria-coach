# Engineering Change Log — this pass

Phases executed per the skill pack: forensics → PS audit → security → resume
intelligence → JD matching → orchestration → evaluation → voice coaching →
evidence integrity → learning roadmap → QA/red team → judge review.

## New capabilities

| Capability | Files | PS rows |
|---|---|---|
| Learning engine: gap-driven plan with curated resources, drills, re-tests | `backend/insights.py`, `backend/resources.py`, `frontend/src/components/InsightsPanels.tsx` | O, P |
| Strengths / Weaknesses / Opportunities report, every item provenance-labelled | `backend/insights.py`, `InsightsPanels.tsx` | B, C, D, E |
| Claim interrogator: quantified resume claims → interview probes | `backend/insights.py::extract_claims`, claims block in `_score_question`, claim UI | H, J |
| Technical rubric (correctness heaviest) vs behavioral rubric, per question type | `backend/coach.py` (`TECH_DIMENSIONS`, `TECHNICAL_RUBRIC`) | J, N |
| Truth guard: fabricated numbers in model revisions redacted to `[add metric]` | `backend/coach.py::_check_model_facts` | K, T |
| Observable delivery coaching: fillers, wpm, restarts from transcript + duration | `backend/speech.py`, `useVoice.ts` duration capture, `SpeechCoachPanel` | L, M |
| Explainable readiness profile (6 components, honest missing-data states) | `backend/insights.py::build_readiness`, `ReadinessPanel` | R |
| Longitudinal progress endpoint (improvement computed from stored attempts) | `backend/server.py::/api/progress` | R |
| Enforced offline mode: `ARIA_OFFLINE=1` skips cloud before constructing calls | `backend/brain.py`, server pre-warm, `.env.example` | W |
| On-device STT fallback: faster-whisper small (CPU int8), benchmarked 1.5 s/3 s audio | `backend/brain.py::transcribe_local` | W, S |
| Session isolation per browser tab (X-Session-Id + contextvars) | `backend/coach.py::_SessionProxy`, `server.py::session_scope`, `useInterview.ts::apiFetch` | U |
| Test suite: 92 regression tests (core + API + security + offline + learning plan) | `tests/test_core.py`, `tests/test_api.py`, `tests/test_learning_plan.py` | all |

## Bug fix — the learning plan existed, but was not on screen

**Symptom.** A session always ended after the configured number of questions;
after that the UI showed the session summary, practice habits, camera setup and
the scored answers, and nothing else. The plan, the readiness snapshot and the
S/W/O report were never rendered.

**Cause.** Not the backend. `coach.state()` had been returning `learning_plan`,
`readiness` and `sow_report` all along, `/api/interview/answer` shipped them
inside its `state` payload, and `useInterview` had been storing them since the
panel was written. The panels were mounted in `InterviewView` *above* the
session flow and gated behind `learning_plan.items.length > 0`, with no fallback
at all — so the candidate had to scroll back up past the whole session to find
the plan, and an empty plan rendered nothing whatsoever.

**Changes**

| Area | Change | Files |
|---|---|---|
| Placement | Completion flow rebuilt: SESSION COMPLETE → READINESS SNAPSHOT → TOP WEAKNESSES → PERSONALIZED LEARNING PLAN → resources + drills + re-test → previous/target → retry action. Full S/W/O report moved into a collapsed disclosure. Readiness + plan also stay live mid-session, so the rebuild is visible after every answer. | `frontend/src/components/InterviewView.tsx` |
| Plan content | Each item now renders priority, topic, effort, “Recommended because:”, Origin, Evidence (or an explicit “none on file”), Do this, Mini drill, the curated resource (provider/difficulty/time/offline alternative) and Re-test. | `frontend/src/components/InsightsPanels.tsx` |
| New views | `TopWeaknesses` (top 3, each evidence-cited) and `RetestPanel` (real stored before → after per question, negatives shown as negatives, re-test action). | `InsightsPanels.tsx` |
| Honest fallback | An empty plan renders a real card stating what was checked and found clean instead of `null`. | `InsightsPanels.tsx` |
| Re-test mapping | A plan item gets a “Re-test this now” button only when it maps to an answered question scored on that competency. No invented mapping. | `InterviewView.tsx` |
| Session length | `INTERVIEW_LENGTH` (default 6, `ARIA_INTERVIEW_LENGTH` override) replaces the hard-coded 6 in the prompt and the `[:6]` truncation; exposed as `state()["interview_length"]` and shown in the UI header. | `backend/coach.py`, `useInterview.ts`, `App.tsx`, `InterviewView.tsx` |
| Rubrics | `frontend/src/lib/rubrics.ts` is the single frontend definition, mirrored from `coach.DIMENSIONS`/`TECH_DIMENSIONS`. A technical answer is labelled *Technical rubric* and never “HR scorecard”; the hero copy and the scoring line were corrected too. | `lib/rubrics.ts`, `InterviewView.tsx` |
| Tests | 27 new unit/structural tests + 6 API chain tests + a real-browser smoke test that drives the whole journey. | `tests/test_learning_plan.py`, `tests/test_api.py`, `frontend/scripts/learning-plan-smoke.mjs` |

**Not done in this pass (P1, deliberately).** Adaptive in-session follow-ups.
Question *generation* is adaptive; follow-ups within a session are still static.
It did not displace the plan fix.

## Deliberately NOT built (this pass)

No dynamic question-count system — 6 became one named constant with an env
override, which is what the requirement asked for; a full scheduling engine is
not warranted. No invented re-test deltas: the re-test loop reports only numbers
already stored, and the smoke test asserts `delta == after - before`.

## Security fixes (full detail: `docs/SECURITY-AUDIT.md`)

CORS wildcard closed · 15 MB upload cap + byte-sniffed type validation ·
cloud-call timeouts · event-loop offloading (`asyncio.to_thread`) · transcript
log redaction · hourly audio pruning · cloud TTS fallback removed · rate
limiting · tolerant import · binary-file rejection · strict session-id
validation.

## Setup fixes

- `requirements.txt`: `kokoro-onnx>=0.6.0` cannot install on Python 3.14 →
  relaxed to `>=0.4.4` (same API); added `faster-whisper`, `pytest`.
- `.env.example`: documents `ARIA_OFFLINE`, `LOCAL_STT_MODEL`, timeouts, `ARIA_DB`.

## Deliberately NOT built

No facial-emotion anything (already removed upstream; kept out), no hiring
prediction, no fake ATS score, no LLM-invented resource URLs, no auth server
(local-first single-user app), no new microservices or databases.

## Verification gate (this pass)

| Check | Result |
|---|---|
| `python -m pytest tests/ -q` | **92 passed** (test_core 40 · test_api 25 · test_learning_plan 27) |
| `npm run build` (tsc + vite) | ✓ |
| `npm run lint` | 0 errors in `src/`; 3 errors are all in vendored `public/wasm` (documented baseline, left failing rather than suppressed) |
| `npm run verify` (build + contrast + face metrics) | ✓ |
| `node scripts/a11y-audit.mjs <url>` | ✓ 0 serious/critical, 0 minor, 17 tabbables, 0 unnamed controls |
| `node scripts/learning-plan-smoke.mjs <url>` | ✓ **PASSED** twice — offline (Ollama): upload → JD → 6/6 questions → SESSION COMPLETE → readiness → top weaknesses → plan (6 items) → catalog resource → drill → real re-test delta `42 → 42 (0)`; cloud (Groq): same journey, delta `45 → 0 (-45)`, rendered as a negative. Asserted `delta == after − before` in both. |
| `scripts/offline_journey.py 8041` | ✓ OFFLINE JOURNEY VERDICT: PASS (18 checks, local Ollama) |
| `node scripts/face-metrics-test.mjs` | all pass |
| Live server boot + `/api/health` | ✓ honest engine report |
| Live upload validation (docx/png/binary/oversize) | ✓ actionable 400s |
| Local Kokoro TTS render | ✓ 2.1 s speech from text |
| Offline STT path (`ARIA_OFFLINE=1`) | ✓ cloud skipped, local whisper ran |
| Full pipeline with mocked LLM | ✓ resume→SOW→readiness→plan→score→truth-guard |
| Python compile check (all modules + tests) | ✓ |
