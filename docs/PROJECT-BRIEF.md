# PROJECT BRIEF — paste this whole document into ChatGPT for analysis

> **How to use this file:** paste everything below as one message. It is written
> to be self-contained — you should not need the repository to ask questions,
> though the reviewer is strongly encouraged to read the code paths named here
> before agreeing or disagreeing with any claim in it.

---

## 0. What this project is

**Name:** Aria — AI-Powered Resume & Interview Coach
**Repository:** `hydralgorithm/aria-coach`
**Origin:** hackathon submission built against an official problem statement
titled **"AI-Powered Resume & Interview Coach"**.
**Language/runtime:** Python 3.12+ backend (FastAPI), React 19 + TypeScript +
Vite frontend, SQLite persistence.

### The problem statement it must satisfy (verbatim intent)

> Students and early-career professionals often require personalized support to
> improve resumes, prepare for interviews, and build confidence for job
> opportunities. Traditional career guidance is often generic, expensive, or
> inaccessible. An AI-powered assistant provides fast, private, and personalized
> career guidance **using on-device AI** while ensuring user data remains secure.
>
> Scenario: a student preparing for campus placements uploads a resume. The
> assistant evaluates the resume, suggests improvements for ATS compatibility,
> and conducts an AI-powered mock interview tailored to the student's target
> role. After the interview it provides feedback on communication, confidence,
> technical knowledge, and recommends personalized learning resources.
>
> Objectives: (1) analyze resumes and give personalized feedback; (2) identify
> strengths, weaknesses, opportunities; (3) conduct AI mock interviews tailored
> to the user; (4) evaluate performance and give actionable feedback; (5)
> recommend personalized learning resources and preparation strategies;
> (6) build confidence through continuous practice; (7) ensure fast, private,
> accessible career guidance using on-device AI.

### Product in one paragraph

A candidate uploads a résumé (PDF/OCR) plus a target job description. The system
deterministically parses the résumé, audits how an ATS would have read it, maps
every JD requirement against verbatim résumé evidence, extracts quantified
résumé claims, builds a question set seeded from the resulting gaps, conducts a
voice-first mock interview, scores each answer under a question-type-specific
rubric with every quote verified and every number checked, measures observable
delivery behaviour, and closes the loop with a gap-driven learning plan and
longitudinal progress tracking. Everything above runs on-device when asked.

---

## 1. Repository layout (complete application-code inventory)

14,206 lines of application code + ~2,200 lines of documentation.
Vendored `frontend/public/wasm/*` (MediaPipe) is **not** counted and is excluded
from lint (see §7.6).

```
backend/
  server.py       823   FastAPI app: 21 endpoints, CORS, uploads, rate limits,
                        session scoping, audio pruning, thread-offloading
  coach.py       1281   Orchestration: personas, session state, question
                        planning, scoring rubrics, truth guard, evidence
                        verification, retry/rescore diffing
  insights.py     571   Personalization core: claim extraction, S/W/O report,
                        readiness profile, learning-plan construction
  store.py        611   SQLite persistence, migrations, competency history,
                        behaviour stats, export/import, tolerant coercion
  brain.py        297   Groq chat + Whisper STT, hard timeouts, Ollama local
                        fallback, ARIA_OFFLINE enforcement, per-session chat
  parsing.py      369   PyMuPDF extraction, Tesseract OCR, deterministic ATS
                        parse audit (columns, furniture, encoding, sections)
  speech.py       106   Observable delivery metrics (fillers, wpm, restarts)
  resources.py    243   Curated learning-resource catalog (17 entries, 17 topics)
  tts.py           91   Kokoro ONNX local text-to-speech
  stats.py        303   Published validation math in plain NumPy
  errorbars.py    417   Error-bar computation for the validation report
  audio.py        151   Recording / wav capture helpers
  features.py     110   Deterministic text features

frontend/src/
  App.tsx                    685   App shell, composer, upload, session reset
  components/
    InterviewView.tsx      1616   The main interview surface (largest file)
    ProgressPanel.tsx        480   Longitudinal progress + practice habits
    InsightsPanels.tsx       421   Learning plan, S/W/O report, claim probes
    ValidationPanel.tsx      298   Published eval/error-bar methodology display
    WhereItRuns.tsx          235   Live per-task engine transparency panel
    CameraSetup.tsx          149   Browser framing diagnostics
    DebugPanel.tsx           163   Developer diagnostics
    ui/                      ~500  siri-orb, avatar-orb, button, card, input
  hooks/
    useInterview.ts          690   All API orchestration + session refresh
    useVoice.ts              459   Mic capture, STT, duration capture
    useFaceAnalysis.ts       365   Browser WASM framing metrics
  lib/faceMetrics.ts         271   Deterministic framing-metric analysis
  index.css                        Tailwind v4 theme (OKLCH) + a11y block

frontend/scripts/            Verification harnesses (§7)
  contrast-audit.mjs  196      WCAG AA contrast gate, 24 real pairings
  a11y-audit.mjs      128      axe-core + puppeteer, both app modes
  face-metrics-test.mjs 235    Framing-metric regression checks
  mic-probe.mjs / mic-test.mjs / face-test.mjs / video-probe.mjs

scripts/
  e2e_journey.py    383      Full live user journey + AI-quality probes
  offline_journey.py 175     Same workflow with the cloud key removed
  perf_audit.py     118      Per-step latency measurement
  errorbars.py      173      Regenerates published validation numbers

tests/
  test_core.py      422      40 tests: pure/deterministic core, no network
  test_api.py       267      18 tests: API surface, security, session isolation
                            (model access blocked by the fixture → no API cost,
                             no model loads, no network)
docs/
  PS-COMPLIANCE.md   68      25-row requirement matrix, all IMPLEMENTED
  LOCAL-FIRST.md     98      Locality split, benchmarks, measured latency
  locality.json     201      Machine-readable per-task local/cloud table
  SECURITY-AUDIT.md  48      12 hardened items, each with fix + test
  LEARNING-SYSTEM.md 67      The learning loop design
  DEMO-SCRIPT.md     83      3-minute deterministic demo
  CHANGELOG-ENGINEERING.md 57
  qanda.md          803      Pre-written hostile-judge Q&A
  HACKATHON-PLAN.md 768
  eval/eval_set.json        24 golden answers used for scoring validation
  eval/error-bars.json      Published validation output
skills/                      The 12-skill audit pack used to build this
```

---

## 2. The AI architecture (this is the part to critique hardest)

The stated design principle is **deterministic where deterministic code is
better, LLM only where semantic judgement is genuinely required**. The pipeline:

```
upload
  ├─ parsing.extract_document      DETERMINISTIC   PyMuPDF → Tesseract fallback
  ├─ parsing._build_audit          DETERMINISTIC   ATS parse audit
  ├─ coach._json_call(EXTRACT)     LLM + schema    structured résumé facts
  ├─ insights.extract_claims      DETERMINISTIC   quantified claims + probes
  ├─ coach._coverage               DETERMINISTIC   JD requirement × evidence
  ├─ coach._make_questions         LLM + planner   question set seeded by gaps
  ├─ [interview] coach.score_answer LLM + rubric   per-question scoring
  │    ├─ coach._truth_guard       DETERMINISTIC   fabricated-number redaction
  │    ├─ coach._evidence          DETERMINISTIC   quote verification
  │    └─ speech.analyse           DETERMINISTIC   delivery metrics
  ├─ insights.build_readiness     DETERMINISTIC   6-component profile
  ├─ insights.build_learning_plan DETERMINISTIC   gap → resource + drill
  └─ store + /api/progress        DETERMINISTIC   SQLite → improvement maths
```

**Where the LLM is actually load-bearing** — 5 call sites in total:
four structured `_json_call(...)` sites in `coach.py` (résumé structuring,
JD coverage, question generation, answer scoring) plus one free-chat call,
`brain.chat`, reached from `POST /api/chat`. Everything else in the pipeline is
regex, geometry, arithmetic, or SQLite.

**Rubrics — two, selected by question type** (`coach.py:619`):

| Dimension | Technical (`TECH_DIMENSIONS`) | Behavioral (`BEHAVIORAL_RUBRIC`) |
|---|---|---|
| relevance_structure | 20 | 25 |
| specificity_evidence | 25 | 25 |
| impact_ownership | 20 | 20 |
| communication | 15 | 15 |
| self_awareness | 20 | 15 |

The behavioral rubric's weights are **unchanged from the pre-existing
implementation** — deliberately, so the published error bars in
`docs/eval/error-bars.json` remain valid. The technical rubric is additive.

---

## 3. The differentiating mechanisms

1. **Truth guard** (`coach._truth_guard`). Any number appearing in the model's
   proposed `answer_revision` that is absent from *both* the candidate's answer
   and the résumé text is replaced with `[add metric]`. Deterministic set
   difference, not a prompt instruction. Tested by
   `TestTruthGuard.test_fabricated_number_is_redacted`.

2. **Evidence verification** (`coach._evidence`). Every quote the model returns
   is checked for verbatim presence in the source; non-matching quotes are
   relabelled `source: general` rather than presented as candidate evidence.

3. **Claim interrogator** (`insights.extract_claims`). Regex-extracts quantified
   résumé claims ("Reduced latency 38%…") and attaches shape-matched probes
   ("How was that measured, and what was the baseline?"). Claims are injected
   into the scoring prompt so the model is asked whether the answer defends them.

4. **ATS parse audit** (`parsing._build_audit`). Deterministic checks for
   multi-column geometry, header/footer furniture, encoding damage, table
   layouts, missing contact fields. Ships "what the machine read" raw text next
   to "what you wrote". **Explicitly does NOT produce a universal ATS score** —
   labelled "parser robustness".

5. **Local-first enforcement** (`brain.OFFLINE_ONLY`). See §5.

6. **Session isolation without auth** (`coach._SessionProxy` + contextvars).
   `X-Session-Id` header scopes all state per browser tab; no login, no
   enterprise auth, no cross-user leakage.

---

## 4. API surface (21 endpoints, `backend/server.py`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/transcribe` | audio → transcript (cloud Whisper or local faster-whisper) |
| GET | `/api/health` | engine status per task, `offline_mode` flag |
| POST | `/api/chat` | free-chat with the coach |
| POST | `/api/reset` | clear session |
| GET | `/api/personas` | interviewer personas |
| POST | `/api/interview/resume` | upload + parse + analyse + generate questions |
| POST | `/api/interview/persona` | switch interviewer persona |
| POST | `/api/interview/answer` | score an answer, return evidence + delivery metrics |
| POST | `/api/interview/rescore` | re-score after transcript correction (in place) |
| POST | `/api/interview/retry` | re-answer, return before/after diff |
| POST | `/api/interview/jd` | set/change the JD mid-session |
| GET | `/api/interview/state` | full session state (refresh/restore path) |
| POST | `/api/interview/reset` | reset the interview |
| GET | `/api/history` | practice history |
| GET | `/api/progress` | longitudinal progress, improvement, next action |
| GET | `/api/eval/error-bars` | published validation numbers (read-only) |
| GET | `/api/history/export` | export local history as JSON |
| POST | `/api/history/import` | import history (tolerant of malformed rows) |
| POST | `/api/history/clear` | delete all local history |
| GET | `/api/history/session/{id}` | one session's detail |
| GET | `/api/history/chat/{session}` | one chat session's turns |

**Security constants** (`backend/server.py`):
`LOCAL_ORIGINS` (localhost only — CORS is *not* `*`), `MAX_UPLOAD_BYTES =
15 MB`, `_RATE_LIMIT = 30` requests / `_RATE_WINDOW = 60.0` s per IP+route,
`_SESSION_RE = [A-Za-z0-9_-]{1,64}`, hourly pruning of `static/audio/`.

---

## 5. Local-first architecture — the exact local/cloud split

Recorded machine-readably in `docs/locality.json` (19 tasks). Summary:

**Fully local, always:** PDF text extraction, OCR, ATS parse audit, JD analysis,
resume↔JD matching, claim extraction, truth guard, quote verification, delivery
metrics, rubric selection, learning-plan construction, readiness profile,
progress measurement, TTS (Kokoro ONNX), camera framing (in-browser WASM),
SQLite persistence.

**LLM/STT:** local-capable via Ollama (`llama3.2:3b`) and faster-whisper;
cloud-capable via Groq (`qwen/qwen3.8-27b`, `whisper-large-v3-turbo`).
Cloud is the **default** when a key is present because the rubric judgement is
measurably better; local is used when the cloud is unreachable or when
`ARIA_OFFLINE=1`.

**Embeddings: not used at all.** Matching is deterministic quote verification.
This is a deliberate design choice, not an omission.

**What leaves the machine (cloud mode only):** résumé text (first 14,000 chars)
for structuring; résumé summary + JD focus lines for question generation; the
candidate's answer transcript for scoring; 16 kHz mono WAV for cloud Whisper.

**Never sent in any mode:** the raw uploaded file, camera frames, generated TTS
audio, the practice-history database, local model weights.

**Verified offline** by starting the server with `GROQ_API_KEY=` (empty) and
`ARIA_OFFLINE=1` — `/api/health` then reports `llm_primary: null`, so the cloud
path cannot exist. `scripts/offline_journey.py` then completes
résumé → JD → analysis → 6 questions → answer → score (60/100, `engine=ollama`)
→ retry → learning plan → readiness → progress. **exit 0.**

---

## 6. Configuration

`.env` (see `.env.example`):
`GROQ_API_KEY`, `GROQ_MODEL` (default `qwen/qwen3.8-27b`), `OLLAMA_HOST`,
`OLLAMA_MODEL`, **`ARIA_OFFLINE`** (enforced-offline switch), `LOCAL_STT_MODEL`
(default `small`), `LLM_TIMEOUT` (120s), `STT_TIMEOUT` (60s), `ARIA_DB`,
**`ARIA_INTERVIEW_LENGTH`** (questions per mock interview, default 6).

Dependencies: `groq`, `fastapi`, `uvicorn`, `pydantic`, `python-multipart`,
`pymupdf`, `pytesseract`, `pillow`, `kokoro-onnx`, `onnxruntime`, `soundfile`,
`numpy`, `sounddevice`, `faster-whisper`, `pytest`.
Frontend: `react`, `tailwindcss` v4, `motion`, `lucide-react`,
`@mediapipe/tasks-vision`, `border-beam`, `thinking-orbs`; dev: `typescript`,
`vite`, `oxlint`, `axe-core`, `puppeteer`.

**Deliberately not dependencies:** `scipy`, `sklearn`, `pandas`. The published
validation math (weighted Cohen's kappa, Krippendorff's alpha, Spearman, AUC)
is hand-written in NumPy in `backend/stats.py` so it stays auditable.

---

## 7. Verification — actual results, captured exit codes

Every number below was measured on the development machine
(Windows, Python 3.14.8, CPU-only, Ollama on CPU).

### 7.1 Backend tests
```
.venv/Scripts/python.exe -m pytest tests/ -q     →  exit 0   (92 passed, 3.8 s)
```
The suite is hermetic: the `client` fixture stubs the local TTS engine and makes
`brain.complete` raise if anything reaches a model, so no test spends an API
call or loads model weights. `TestModelIsolation` asserts that guard still
holds. Before this guard existed the API tests took 43 s because they were
really calling the cloud LLM and loading the 353 MB Kokoro model.

`tests/test_learning_plan.py` (27 tests) and `TestLearningPlanChain` in
`tests/test_api.py` (6 of its 25 tests) are the regression net for the bug fixed
in §8.1: the plan must come back from the API on upload, on **every** answer and
from `/api/interview/state`, and the frontend must actually mount the panels it
is handed.

Breakdown: `tests/test_core.py` 40 · `tests/test_api.py` 25 ·
`tests/test_learning_plan.py` 27 = **92**.

### 7.2 Frontend build (TypeScript + Vite)
```
npm run build                                      →  exit 0   (✓ built)
```

### 7.3 Lint
```
npm run lint                                       →  exit 1
Found 540 warnings and 3 errors.
```
**The 3 errors are all in vendored MediaPipe WASM**
(`public/wasm/vision_wasm_internal.js`, `..._module_internal.js`,
`..._nosimd_internal.js`). Verified with `oxlint --format=github`:
**0 errors in `src/`**. This was left failing rather than suppressed.

### 7.4 Accessibility
```
node scripts/contrast-audit.mjs                    →  exit 0   (24/24 pass, 0 fail)
node scripts/a11y-audit.mjs http://127.0.0.1:8000  →  exit 0
  A11Y AUDIT PASSED: 0 serious/critical, 0 minor, 17 tabbables,
  0 unnamed buttons/links (both free-chat and interview modes)
node scripts/face-metrics-test.mjs                 →  exit 0
```
`npm run verify` chains build + contrast + face-metrics (exit 0).

### 7.4b Browser smoke test — the learning plan, through the real UI
```
node scripts/learning-plan-smoke.mjs http://127.0.0.1:8041   →  exit 0
```
Drives the actual built app in Chrome: paste a JD → upload a résumé → answer
all configured questions → assert the completion order, the plan content, the
resource link and a **real** re-test delta. This is the check that would have
caught the original bug; see §8.1.

Actual run (`ARIA_OFFLINE=1`, Ollama `llama3.2:3b`):
```
PASS  questions generated — 6 questions generated
PASS  the configured length is what the backend reports — backend constant 6
PASS  the UI label states the configured length — header "6 QUESTIONS"
PASS  plan already grounded in JD gaps before answering
      answered 1/6 … 6/6
PASS  SESSION COMPLETE shown
PASS  READINESS SNAPSHOT shown
PASS  TOP WEAKNESSES shown
PASS  PERSONALIZED LEARNING PLAN visible without refresh
PASS  documented order: summary -> readiness -> weaknesses -> plan -> re-test
PASS  plan item shows "Recommended because:" / "Origin:" / "Evidence:" /
      "Do this:" / "Mini drill:" / "Re-test:"
PASS  plan renders one row per item — 6 items
PASS  resource links come from the curated catalog —
      https://kubernetes.io/docs/tutorials/kubernetes-basics/
PASS  re-test reports a real before/after from stored attempts —
      1 re-tested: 42 -> 42 (0)
PASS  the improvement number is the real delta, not a boast — 0 vs 0
PASS  no uncaught page errors
SMOKE TEST PASSED
```
The re-test delta was **0**, not a flattering number: the 3B local model scored
both attempts 42. The smoke test asserts `delta == after − before` precisely so
a boast cannot be printed by accident.

The same script was then re-run against the cloud path (Groq `qwen3.8-27b`,
port 8040) and also **PASSED** — and produced a **negative** delta there:
`previous 45 → now 0 (-45)`, rendered as such. That is the point: the loop
reports what happened, in both directions.

### 7.5 Live end-to-end journey (`scripts/e2e_journey.py`, real Groq key)
→ **exit 0, "E2E VERDICT: PASS"**, ~30 checks. Notable results:
```
excellent answer → 54/100    weak → 10    incomplete → 5
wrong technical → 14        ambiguous → 0
truth guard: no fabricated numbers in revision — clean
revision quotes verified or general — pass
injection résumé: processed as data, no key/system leak, 6 questions (not hijacked)
tab B sees empty state; tab A still holds its session
rescore replaced in place and did NOT add an attempt
retry 0 → 54 with diff detecting added numbers
out-of-questions returns a clear 400 after the session drains
```

### 7.6 Offline journey (`scripts/offline_journey.py`, cloud key removed)
→ **exit 0, "OFFLINE JOURNEY VERDICT: PASS"**, 22 checks, ~48 s total.

### 7.7 Performance (`scripts/perf_audit.py`, wall clock, same machine)

| Step | Cloud (Groq 27B) | Local (Ollama 3B, CPU) |
|---|---|---|
| résumé upload → analysis → 6 questions | 11.5 s | 21.8 s |
| answer → score → feedback | 27.9 s | **7.1 s** |
| retry + before/after diff | 38.1 s | 8.3 s |
| rescore (transcript correction) | 55.7 s | 8.8 s |
| progress endpoint | 0.00 s | 0.00 s |
| session state (refresh) | 0.01 s | 0.01 s |

Slowest step: résumé analysis (4 model calls). Other measured costs: Kokoro TTS
2.9 s cold / 0.66 s warm; faster-whisper 0.78 s for 3 s of audio; backend RSS
~867 MB with models warm.

**Notable and counterintuitive:** the local 3B scores ~4× *faster* than the
cloud 27B, and the gap widens on retry because cloud cost grows with accumulated
context. Cloud is the default for rubric *quality*, not speed.

---

## 8. Test inventory

**`tests/test_learning_plan.py` — 27 tests (new, the regression net for §8.1):**
`TestInterviewLengthIsNamed` (7: default is 6, the prompt carries `{length}`
not a literal, `_make_questions` truncates to the constant, `state()` exposes
it, no scattered `[:6]`) · `TestPlanIsCandidateSpecific` (9: JD gap → critical
item quoting the requirement, a *matched* requirement is never recommended,
every item carries topic/priority/why/origin/task/drill/re-test/effort/resource,
a weak competency item quotes the measured average, a strong competency is
never recommended, an unsupported claim quotes the claim, **honest fallback**
when there are no gaps, every URL is in the catalog) ·
`TestRubricParity` (5: the TS weights equal `TECH_DIMENSIONS`/`DIMENSIONS`,
both sum to 100, the technical rubric never says STAR, the UI never says "HR
scorecard") · `TestFrontendRendersThePlan` (6: App passes every prop, the view
accepts and mounts them, the completion order is asserted by index, the empty
plan still renders its fallback, the hook refreshes after every answer, each
item shows "Recommended because:" / origin / drill / re-test, the re-test
numbers come from the stored diff).

**`tests/test_core.py` — 40 tests, no network, no model:**
`TestSpeechMetrics` (5: filler counting, no-duration guard, pace notes, empty
answer, determinism) · `TestClaims` (4: quantified extraction, currency/multiplier,
ignores unquantified, probe-shape matching) · `TestSowReport` (5: all three
sections, unquantified bullet flagged, JD gap → weakness+opportunity, provenance
labels, **never invents metrics in rewrite**) · `TestReadiness` (4: full
components, missing components reported not guessed, parse flags lower
robustness, never labelled a hiring prediction) · `TestLearningPlan` (4: JD gap →
item with resource, weak competency → drill, **no model URLs ever**, catalog URLs
are HTTPS) · `TestTruthGuard` (3) · `TestEvidenceVerification` (2: verified quote
stays, fabricated quote demoted) · `TestRetryDiff` (2) · `TestParseAudit` (3:
plain text, missing email, empty binary rejected) ·
`TestInjectionNeutralizer` (5: injected role removed, key-exfiltration removed,
**clean résumé returned byte-identical**, a real "Systems Administrator" résumé
survives, JD injection removed) · `TestStore` (3: roundtrip, weak-competency
ordering, **import survives malformed rows**).

**`tests/test_api.py` — 25 tests via FastAPI TestClient, all model calls
blocked (the suite costs no API calls, no network, and no model loads):**
`TestModelIsolation` (2: the LLM entry point is blocked, and the résumé endpoint
cannot reach a model — a self-test of the fixture's own promise) ·
`TestHealth` (2) · `TestUploadValidation` (4: docx rejected with guidance, image
rejected with guidance, empty PDF rejected actionably, oversize rejected *before*
parsing) · `TestSessionIsolation` (2: two tabs cannot see each other's persona,
invalid session header falls back) · `TestRateLimit` (1: runaway client gets 429)
· `TestPromptInjection` (1) · `TestChatErrorHandling` (2: LLM failure → 502 with a
clear message, rate limit) · `TestProgressEndpoint` (1) · `TestOfflineMode` (3:
offline blocks cloud, **offline actually reaches the local model** — regression
test for a real shipped bug, offline transcription skips cloud) ·
**`TestLearningPlanChain` (6, new)** — upload returns the plan + the configured
length, questions are capped at it, **every answer response carries a rebuilt
plan, readiness and SOW report**, the plan reflects the session just answered,
`/api/interview/state` serves the same plan, the plan survives a reload, and
every resource URL is in the curated catalog.

---

## 8.1 The bug behind this pass: the learning plan existed, but nobody could see it

**Symptom.** A session always ended after the configured number of questions.
After that the UI showed the session summary, practice habits, camera setup and
the scored answers — and nothing else. The personalized learning plan, the
readiness snapshot and the S/W/O report were never on screen, even though
`/api/interview/state` returned all three.

**What the data flow actually was.**

```
insights.build_learning_plan(coverage, sow, claims)   backend/insights.py:408
        │  candidate-specific: JD gaps → measured weak competencies
        │  → unsupported resume claims. Resources from resources._CATALOG (17
        │  entries); the model never writes a URL.
        ▼
coach.state()                                        backend/coach.py:318
        │  rebuilds SOW + readiness + plan on every call
        ▼
POST /api/interview/resume  ─┐
POST /api/interview/answer  ─┼─► { sow_report, readiness, learning_plan }
GET  /api/interview/state   ─┘
        ▼
useInterview.submitAnswer() / loadResume()          frontend/src/hooks/useInterview.ts
        │  state.sow_report / readiness / learning_plan
        ▼
App.tsx  <InterviewView sow_report readiness learning_plan … />
        ▼
InterviewView.tsx
        ├── SOW / readiness / learning-plan panels were mounted ABOVE the
        │   session flow, before the resume card region the candidate reads
        │   first, and the whole page scrolls — so the plan sat far above the
        │   "Session complete" summary that the candidate is actually looking at
        └── nothing rendered them when the guard
            `learning_plan.items.length > 0` failed, and the empty case had no
            honest fallback at all
```

The backend was never the problem: a live probe returned **6 plan items on
upload and 6 after all six answers**. The bug was presentation and plumbing,
which is exactly the kind of bug a passing API test cannot see.

**The fix.**

| Area | Change |
|---|---|
| Placement | The three panels moved into the completion flow: SESSION COMPLETE → READINESS SNAPSHOT → TOP WEAKNESSES → PERSONALIZED LEARNING PLAN → resources + drills + re-test → previous/target → retry action. The full S/W/O report is a collapsed disclosure underneath. |
| Mid-session | Readiness and the plan stay live below the question beam, so the candidate sees the plan re-form after every answer — that *is* the "no refresh" requirement. |
| Plan content | Every row now shows priority, topic, effort, **“Recommended because:”**, **origin**, **evidence** (or an explicit “none on file — that absence is the reason this is here”), a practice task, a mini drill, the curated resource with provider/difficulty/time/offline alternative, and the re-test instruction. |
| Honest fallback | An empty plan renders a real card saying what was checked and found clean, instead of `return null`. `origin: "general"` is labelled "no specific gap found". |
| Re-test | `RetestPanel` shows the **stored** before/after per question (`previous 47 → now 66 (+19)`, negative deltas shown as negative) and offers a re-test action. A plan item only gets a “Re-test this now” button when it maps to an answered question scored on that competency — nothing is faked. |
| Session length | `coach.INTERVIEW_LENGTH` (default 6, `ARIA_INTERVIEW_LENGTH` override) replaces the hard-coded 6 in the prompt and the `[:6]` truncation; `state()` exposes it and the header renders it. |
| Rubrics | `frontend/src/lib/rubrics.ts` is now the single frontend definition, mirrored from `coach.DIMENSIONS`/`TECH_DIMENSIONS`. A technical answer is labelled *Technical rubric* (correctness & approach, reasoning & depth, trade-offs & alternatives, clarity of explanation, edge cases & limits) and never “HR scorecard”; `tests/test_learning_plan.py::TestRubricParity` fails if the two files drift. |

---

## 9. Security hardening performed (`docs/SECURITY-AUDIT.md`)

Bugs found and fixed during the audit pass:
1. `CORSMiddleware allow_origins=["*"]` — any website could read `/api/history`.
   → pinned to `LOCAL_ORIGINS`.
2. Global `coach._state` / `brain._history` — two tabs clobbered each other.
   → contextvar-backed `_SessionProxy` + `X-Session-Id`.
3. No timeouts on cloud calls; blocking sync work inside `async def` endpoints.
   → hard timeouts + `asyncio.to_thread`.
4. Unbounded upload (a 2 GB body into RAM); `.docx`/binary mangled into the LLM.
   → 15 MB cap + byte-sniffed type validation with actionable errors.
5. Cloud TTS fallback (`edge-tts`) sent coach replies — quoting the candidate's
   words — to Microsoft. → removed.
6. Transcripts printed to logs. → redacted.
7. Generated TTS audio accumulated on disk forever. → hourly pruning.
8. `kokoro-onnx>=0.6.0` made the backend uninstallable on Python 3.14.
   → pinned to a compatible line with an explanatory comment.

---

## 10. PS compliance claim

`docs/PS-COMPLIANCE.md` claims **25 of 25 requirements IMPLEMENTED**, zero
PARTIAL, zero MISSING, zero CLAIMED-BUT-UNPROVEN. Each row cites file,
function, test, and user-visible evidence.

**The project is explicitly sceptical of its own strongest-sounding claims.**
The doc contains a "what each row is actually worth" table stating real limits,
including: the ATS audit checks known failure modes only and does not replicate
any real ATS vendor; the scoring validation rests on 24 self-labelled eval
answers with **unmeasured human inter-rater agreement**; confidence is *not*
detected psychologically; improvement is `null` rather than invented when only
one session exists.

**Explicitly NOT built, by design:** live interview copilot/cheating, hiring
prediction, facial-emotion scoring, "nervousness detection", fabricated résumé
metrics, fake ATS scores, generic chatbot features, microservices, embedding
infrastructure.

---

## 11. Reviewer instructions — please be adversarial

The following questions are ones a hostile hackathon judge would ask. The
project's answers are given with code references so they can be checked:

1. **"Why isn't this ChatGPT + PDF upload?"** → check `coach.py`: 5 LLM call
   sites vs. ~15 deterministic modules; `docs/locality.json`.
2. **"Is the personalization real or a prompt?"** → `insights.build_learning_plan`
   maps *this candidate's* JD gaps and stored competency scores to catalog
   entries. Check `TestLearningPlan`.
3. **"How does the JD change the interview?"** → `coach._coverage` →
   `coach._focus_lines` → `_make_questions`.
4. **"How does previous performance change future questions?"** →
   `store.weak_competencies` (avg < 60 from stored attempts) re-queues weak
   competencies.
5. **"How do you stop it hallucinating?"** → `coach._truth_guard` +
   `coach._evidence`; tests named above.
6. **"Does it detect confidence from faces?"** → grep the codebase for
   emotion/psychology: every hit is a disclaimer. Face metrics are framing only
   and never enter the score.
7. **"What actually runs locally?"** → `docs/locality.json`, 19 tasks.
8. **"What's your weakest point?"** → the project's own answer is in
   `docs/PS-COMPLIANCE.md`'s limits table. Agree or disagree with it.

**Specifically worth attacking:**
- Is 14k lines too much for the product? Is `InterviewView.tsx` (1,616 lines)
  a maintainability problem?
- Is the "deterministic where possible" principle actually followed, or is it
  decorative?
- Is the 24-answer eval set sufficient to claim the scoring works?
- Is `llama3.2:3b` good enough that offline mode is genuinely usable, or is it
  a demo trick?
- Does session-via-header-without-auth actually isolate anything meaningful for a
  local-first single-user app, or is it theatre?

---

## 12. Explicitly unverified / known limitations

State these if you are reviewing; do not let them be claimed as strengths.

1. Human inter-rater agreement on scores is **not measured**.
2. The eval set (24 answers) is self-labelled; error bars are self-computed.
3. The local 3B rubric is shallower than the cloud 27B.
4. Offline first use needs Ollama's 2 GB model pulled and ~460 MB of whisper
   weights downloaded.
5. WCAG gates check pairings, semantics and accessible names the app controls;
   they are not a substitute for testing with disabled users.
6. `npm run lint` exits 1 because of vendored WASM.
7. `scripts/errorbars.py analyze` was not re-run in the latest pass (it needs
   scored runs plus a judge model).
8. Ollama's CUDA path was broken on this machine; local inference was measured
   on **CPU** only.