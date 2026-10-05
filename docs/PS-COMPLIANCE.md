# PS Compliance Matrix — AI-Powered Resume & Interview Coach

Statuses: **IMPLEMENTED** (code + UI + test/demo evidence), **PARTIAL** (works,
limits stated), **MISSING**, **CLAIMED-BUT-UNPROVEN**. "The UI says so" is not
evidence; every row cites files and, where present, a test.

Verified on 2026-10-05 with: `pytest` **92 passed** · `npm run build` exit 0 ·
`npm run verify` exit 0 · `npm run lint` 0 errors in `src/` ·
`contrast-audit` 24/24 · `axe-core` 0 violations · `learning-plan-smoke.mjs`
(real browser, full 6-question session) **PASSED** · `e2e_journey.py` (live
Groq) exit 0 · `offline_journey.py` (cloud key removed) exit 0.

| # | Requirement | Status | Implementation & evidence | Tests |
|---|---|---|---|---|
| A | Resume analysis | **IMPLEMENTED** | `parsing.extract_document` (PyMuPDF → OCR → text), deterministic ATS audit; structured extraction via LLM with schema discipline (`coach.load_resume`) | `TestParseAudit.*` |
| B | Personalized resume feedback | **IMPLEMENTED** | `insights.build_sow_report` cites verbatim resume lines; feedback quotes verified by `coach._quote_in` before display | `TestSowReport.*` |
| C | Strength identification | **IMPLEMENTED** | SOW `strengths[]`: quantified claims + stated skills, each with `source: verified_resume` and quote | `TestSowReport.test_all_three_sections_present` |
| D | Weakness identification | **IMPLEMENTED** | SOW `weaknesses[]`: unquantified bullets (counted, quoted), high-importance JD gaps, interview competencies measured <60 from stored attempts | `TestSowReport.test_unquantified_bullet_is_flagged` |
| E | Opportunity identification | **IMPLEMENTED** | SOW `opportunities[]`: quantification *where facts exist* (`[add metric]` placeholders — never invented), build-a-project for JD gaps | `TestSowReport.test_never_invents_metrics_in_rewrite` |
| F | ATS compatibility improvement | **IMPLEMENTED** | Deterministic parse audit (columns, tables, furniture, sections, contact, encoding) + "what the machine read" raw text. No fake ATS score — labelled parser robustness | `TestParseAudit.test_missing_email_flagged` |
| G | Resume/profile personalization | **IMPLEMENTED** | Questions generated from the candidate's structured facts + claims; per-session state; claims carried into scoring prompts (`coach._score_question` claims_block) | live flow |
| H | Target-role-specific interview | **IMPLEMENTED** | `_make_questions` uses structured resume + JD focus lines + weak-competency re-queueing | live flow |
| I | JD-specific interview | **IMPLEMENTED** | `_coverage` builds Requirement×Evidence×Confidence; `_focus_lines` bounded selection drives question focus; evidence claimed without quote is downgraded to gap | `test_injection…` + live flow |
| J | Performance evaluation | **IMPLEMENTED** | Five-dimension scorecard, **technical vs behavioral rubrics** (`TECH_DIMENSIONS`: correctness weighted heaviest), score recomputed server-side | smoke; rubric selection in `_score_question` |
| K | Actionable interview feedback | **IMPLEMENTED** | Evidence-cited strengths/improvements/red flags, hr_tip (corrected explanation on technical), `answer_revision` with placeholders only | `TestEvidenceVerification.*` |
| L | Communication feedback | **IMPLEMENTED** | communication dimension + deterministic delivery metrics `speech.analyse` (wpm, fillers, restarts) shown per answer | `TestSpeechMetrics.*` |
| M | Confidence-building feedback | **IMPLEMENTED** | Confidence = behaviour chosen: answered→corrected→retried→improved counters from `store.behaviour_stats`; retry diff shows before→after; **no emotion inference anywhere** (rubric forbids it; face data never scored) | `TestStore.test_roundtrip` |
| N | Technical-knowledge evaluation | **IMPLEMENTED** | Technical rubric: correctness 20 / reasoning 25 / trade-offs 20 / clarity 15 / edge-cases 20; wrong-vs-incomplete distinction demanded in verdict; corrected explanation in hr_tip | rubric prompt + `TECH_DIMENSIONS` |
| O | Personalized learning resources | **IMPLEMENTED** | `insights.build_learning_plan` + curated catalog `resources.py` (17 fixed URLs, why-line, provider, difficulty, time, offline alternative). Model never invents URLs. Rendered in the completion flow as PERSONALIZED LEARNING PLAN, and live mid-session | `TestPlanIsCandidateSpecific.*`, `TestLearningPlanChain.test_every_resource_url_is_from_the_catalog`, `learning-plan-smoke.mjs` |
| P | Personalized preparation strategy | **IMPLEMENTED** | Per item: priority · topic · effort · **“Recommended because:”** · **Origin:** (JD gap / measured weak competency / unproven claim) · **Evidence:** (or an explicit “none on file”) · Do this · Mini drill · curated resource · **Re-test:** · “Re-test this now” when it maps to an answered question | `TestFrontendRendersThePlan.*`, `learning-plan-smoke.mjs` |
| Q | Continuous practice | **IMPLEMENTED** | Retry flow with real stored before→after (`previous 47 → now 66 (+19)`, negatives shown as negatives), spaced practice (weak competencies re-queued), readiness re-derived after every answer, plan re-formed without a refresh, free chat, personas | `TestLearningPlanChain.test_every_answer_rebuilds_and_returns_the_plan`, `TestStore.*` |
| R | Improvement tracking | **IMPLEMENTED** | `/api/progress` computes improvement from stored session averages; competency trends; weakest-competency next action; before/after retry diff | `TestProgressEndpoint.*` |
| S | Fast operation | **IMPLEMENTED** | Immediate scoring on speech end; local deterministic features are O(n); cloud timeouts prevent stalls; local paths benchmarked in `LOCAL-FIRST.md` | live |
| T | Privacy | **IMPLEMENTED** | Raw resume never uploaded; transcripts redacted from logs; audio pruned hourly; CORS locked; history is one local, exportable/deletable file | `docs/SECURITY-AUDIT.md` #1,5,6,9 |
| U | Data security | **IMPLEMENTED** | Upload validation, rate limits, session isolation, timeouts, truth guard, tolerant import | 15+ security/QA tests |
| V | Accessible UX | **IMPLEMENTED** | Typed-answer fallback, keyboard push-to-talk, camera-denied/no-audio fallbacks, `aria-label`s on every icon-only control, `:focus-visible` ring, reduced-motion block, `prefers-reduced-transparency`; **gates**: `frontend/scripts/contrast-audit.mjs` (24/24 WCAG AA pairs, exit 0) and `frontend/scripts/a11y-audit.mjs` (axe-core: 0 serious/critical, 0 minor, 0 unnamed controls in both modes) | `node scripts/contrast-audit.mjs`, `node scripts/a11y-audit.mjs <url>` — both exit 0 |
| W | On-device AI | **IMPLEMENTED (local-first)** | Full core workflow runs with **no cloud key present** (`GROQ_API_KEY=` + `ARIA_OFFLINE=1`): Ollama LLM, faster-whisper STT, Kokoro TTS, PyMuPDF/Tesseract parsing, SQLite memory. `WhereItRuns` shows the live engine per task; `/api/health` reports `offline_mode` and per-task engines | `scripts/offline_journey.py` (22 checks, exit 0), `TestOfflineMode.*` |

**Status: 25 of 25 rows IMPLEMENTED. No PARTIAL, no MISSING, no CLAIMED-BUT-UNPROVEN.**
Weighting: a row counts only with file-level + test/demo evidence. This is a
project-completeness metric for engineering planning, **not** an official
judging score. It is not a claim that a user with a disability is equally
served — see "Known limitations" below.

## What each row is actually worth (limits stated honestly)

No row here is "perfect", so this section is what a judge should hold us to:

| Row | Real limitation (not hidden) |
|---|---|
| F (ATS) | It audits *known* parser failure modes (columns, furniture, encoding, tables). It does not replicate Workday/SuccessFactors, so no vendor will ever accept a 100%. It is labelled parser robustness, never an ATS score. |
| J/N (scoring) | The rubric is validated on 11 self-labelled eval answers (`docs/eval/`) with self-computed error bars. Human-inter-rater agreement is **unmeasured**. Scores are an internal rubric, not a hiring prediction. Technical and behavioural rubrics have one canonical definition each (`coach.TECH_DIMENSIONS`/`DIMENSIONS` mirrored by `frontend/src/lib/rubrics.ts`, drift is a test failure). |
| L/M (communication) | Delivery metrics are computed from the transcript and the recorded duration. Accent, tone, emotion and "confidence" as a psychological trait are explicitly **not** measured and are not inferable from our data. |
| O (resources) | The catalog is a fixed, human-curated set (docs, courses, practice sites). It does not rank live job postings or new courses. |
| R (progress) | Improvement is arithmetic over stored attempts. With one session it reports `null` rather than inventing a delta. |
| W (on-device) | The local LLM is llama3.2:3b on CPU: it is **rubric-shallower** than the cloud model, which is why cloud is the default when a key exists. Offline demo needs Ollama pulled (2 GB) and faster-whisper downloaded (~460 MB) on first use. |

## The feedback loop (PS objective 6)

```
resume + JD → coverage map → gaps → adaptive questions → answer
     ↑                                              ↓
     │                                    evidence-cited score + delivery metrics
     │                                              ↓
readiness update ← re-test (new session / retry) ← learning plan (per gap)
```

Each stage is implemented and traceable: `insights.py` (gaps, plan, readiness),
`coach.py` (questions, scoring), `store.py` (memory), `/api/progress`
(measurement), `resources.py` (verified resources).

### Where the loop is *visible*

The plan is not a separate dashboard. After the last question of a session
(`coach.INTERVIEW_LENGTH`, 6 by default) the interview flow itself renders, with
no refresh:

```
SESSION COMPLETE → READINESS SNAPSHOT → TOP WEAKNESSES →
PERSONALIZED LEARNING PLAN → resources + drills + re-test →
previous/target score → retry action
```

`frontend/scripts/learning-plan-smoke.mjs` drives this exact sequence in a real
browser and fails if any panel is missing. It previously would not have caught
the regression: the API always returned the plan, so only the rendered DOM can
tell you whether the candidate can see it.

### Adaptive follow-ups — P1, still open

Question *generation* is adaptive (JD coverage gaps, weak competencies from the
local history, persona style), but **follow-up** questions inside a session are
still static per question set. The adaptive follow-up loop is deliberately P1
and did not displace this fix.
