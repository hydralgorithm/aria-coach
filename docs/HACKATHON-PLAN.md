# Aria — Girl Geeks 2026 Hackathon Plan

**Event:** IEEE Computer Society Bangalore Chapter — Girl Geeks 2026 (8th edition, national level)
**Use case:** Official Use Case 01 — "AI-Powered Resume & Interview Coach"
**Status:** strategy locked, implementation in progress — see §11 progress log

---

## 1. The situation

Girl Geeks teams must select one of two official use cases, and the brief states:

> "Projects developed outside these problem statements will not be considered for evaluation."

So we are **not** being asked to find an underserved market. We are being scored against a
written list of objectives. That changes the optimisation target entirely: build the generic
brief well and we tie with every other team doing the same thing.

**Win condition:** exhaust the brief, then own the two objectives nobody will touch —
*"build confidence through continuous practice"* and
*"fast, private, and accessible career guidance using on-device AI."*

### Objective coverage

| # | Official objective | Current state | Plan |
|---|---|---|---|
| 1 | Analyze resumes and provide personalized feedback | done (PyMuPDF + OCR, LLM extraction) | add parse audit (2) |
| 2 | Identify strengths, weaknesses, opportunities | partial — uncalibrated 0–100 number | bands + confidence + evidence (4) |
| 3 | Conduct mock interviews tailored to user profile | partial — resume only | + JD → requirement/evidence map (6) |
| 4 | Evaluate performance, provide actionable feedback | partial — generic tips | every claim cites a span (4) |
| 5 | Recommend personalized learning resources | **missing** | **cut** (see §7) |
| 6 | Build confidence through continuous practice | **missing** | retry loop + growth history (7) |
| 7 | Fast, private, accessible, **on-device AI** | partial — LLM + STT call Groq | local STT + local parsing (5) |

Application scenario also says: *"suggests improvements for ATS compatibility."*
→ covered by the parse audit (2).

---

## 2. Positioning

> **Aria shows you what the machine actually received — not what you meant.**
>
> Your résumé: *this is what the parser extracted.*
> Your answer: *this is what the mic heard.*
> Your score: *and here's exactly which of your words it came from.*
>
> **Aria never invents a number for you — not in your résumé, not in your interview.**

Supporting line for the pitch:

> **Aria is the interview coach that shows its work — and shows its mistakes.** It tells you
> what it heard before it scores you, cites the exact words behind every observation, refuses
> to judge your face or your accent, runs locally where local is just as good, and publishes
> how often it disagrees with human raters.

Every clause is verifiable rather than asserted. That is the strategy.

### Why the "never invents a number" clause is the moat

An independent [2026 test of six AI resume builders](https://atsverification.com/blog/ai-resume-builders-tested-2026/)
against Workday, Greenhouse, Lever and Taleo concluded:

> "All six tools generate fictional achievement metrics, none can verify the numbers they
> suggest. You own the truth of what you put in your resume."

The entire AI career-tools category optimises for you getting hired. A tool that shows you the
machinery and then declines to fabricate is a position competitors cannot copy without
changing their business model. **This is the single strongest asset we have.**

---

## 3. Research findings

### 3.1 The feature set is table stakes

- [**DeepInterview**](https://github.com/ngoanpv/DeepInterview) (Apache-2.0): CV + JD upload,
  adaptive interviewer, LiveKit barge-in, company research, question plan **with rubrics**,
  per-competency scores, study coach, fully-local Ollama + Whisper + Kokoro path.
- [**Interview Copilot**](https://interviewcopilot.io/) ships retry-and-compare, "weak areas
  carried across sessions", and the disclaimer "practice signal — not a hiring prediction."
- [**Huru**](https://huru.ai/compare/huru-vs-final-round-ai/) owns the "we train you to answer
  yourself" positioning. Rezi, Teal, Jobscan own ATS. Yoodli, Final Round AI, Big Interview
  own commercial mock interviews.
- Dozens of weekend repos under GitHub topics `ai-interviewer`, `interview-platform`,
  `career-coach`, `resume-scoring`.

→ resume + JD + voice + scoring + personas is a finished category. Differentiation must come
from somewhere nobody is.

### 3.2 "Score theater" is a real, citable defect

- [Rating Roulette: Self-Inconsistency in LLM-as-a-Judge (arXiv 2510.27106)](https://arxiv.org/html/2510.27106)
  — LLM judges show **low intra-rater reliability** across identical runs, and forcing
  determinism (temperature 0) makes agreement with humans **worse**. Fix = disclose variance,
  not suppress it.
- [BARS improves structured-interview validity (Kell et al. 2017, ETS)](https://onlinelibrary.wiley.com/doi/full/10.1002/ets2.12152)
  — behaviourally anchored scales raise reliability and cut bias.
- [Wingate et al. 2025, *IJSA*](https://www.semanticscholar.org/paper/e621c0546dd64f120b65ae3290f94e5c78c57a6b)
  — first meta-analysis of construct-specific interview validity: score the construct you name.
- Sackett et al. (2021/22) revised the classic validity matrix downward.
- **[Järvilehto et al. 2026, *Behavioral Sciences & the Law*](https://pmc.ncbi.nlm.nih.gov/articles/PMC12865673/)**
  — LLMs **beat** psychologists at *static* question formulation but **collapse in adaptive
  dialogue**. Do not make open-ended autonomy the flagship.
- **[E-AVI (arXiv 2609.20001)](https://arxiv.org/abs/2609.20001)** and
  **[PhoenixNest-Video (arXiv 2609.02231)](https://arxiv.org/abs/2609.02231)** — 2026 papers
  arguing bare numerical predictions give "limited inspectable support"; both propose
  timestamped evidence extraction and evidence-deletion ablations.

### 3.3 Nobody publishes their error bars

Interview Copilot, Huru, Yoodli, Final Round AI, Big Interview, Rezi, Teal, Jobscan,
DeepInterview, InterviewMentor — **all ship scores, none ship validation.** Cheapest credible
differentiator available to us.

### 3.4 Nobody ships the transcript gate

Searched editable-transcript-before-scoring across the whole category. Nothing. Meanwhile:

- [Meta-analysis of accent bias in employee interviews (Maindidze et al. 2025, *IJSA*)](https://onlinelibrary.wiley.com/doi/10.1111/ijsa.12519)
  — non-standard accents measurably reduce hireability ratings.
- [Atypical-speech bias encoded into ASR (arXiv 2601.18641)](https://arxiv.org/pdf/2601.18641)
- [**Scribe and Prejudice?** (Ada Lovelace Institute, Feb 2026)](https://www.adalovelaceinstitute.org/report/scribe-and-prejudice/)
  — documents ASR bias as a live harm.
- [ADA.gov — Algorithms, AI and disability discrimination](https://www.ada.gov/resources/ai-guidance/)

**The bug:** a candidate with a regional accent is misheard → scored low → told to "add more
metrics" for a sentence they said perfectly. The score is silently computed from a corrupted
transcript. This is the single most *relevant* defect for a Bangalore women's-tech audience.

### 3.5 ATS scores are themselves unvalidated — do not build one

- The famous "75% of resumes auto-rejected" stat traces to [a bankrupt company's 2012 sales pitch](https://www.kraftcv.com/blog/ats-myths-debunked-resume-rejected-2026).
  [92% of recruiters say ATS does not auto-reject](https://resumegeni.com/blog/why-92-percent-recruiters-say-ats-doesnt-auto-reject).
- Per the 2026 builder test, Jobscan's own weakness: *"the match-score number is opaque, it's
  not the same as the score an ATS would actually give you. Treat it as directional."*

Shipping an ATS **score** would be a second uncalibrated 0–100 number — the exact thing we are
removing from the interview side. Publishing error bars for one metric while inventing another
would not survive a judge's question.

**But parse rate is real and reproducible** (same test, 4 engines):

| Tool class | Parse rate |
|---|---|
| Rezi / Teal (single-column) | 88–96% |
| Enhancv / Resume.io (two-column) | **failed 30–45%** |

→ **Keep the parse audit. Drop the ATS score.**

### 3.6 Spaced practice is supported, transfer is weaker than advertised

[Latimier et al. 2021 meta-analysis](http://www.lscp.net/persons/ramus/docs/EPR20.pdf) supports
spaced retrieval. [Corral et al. 2025](https://www.sciencedirect.com/science/article/pii/S0959475225001434)
finds the effect on *transfer* is much weaker. Ship spaced re-asking; **do not** claim it
predicts hire outcomes.

---

## 4. Legal / ethical boundaries

### Facial affect must not influence scores

- **[EU AI Act Article 5(1)(f)](https://artificialintelligenceact.eu/article/5/) prohibits
  inferring emotions in the workplace and education.** In force since **2 Feb 2025**. The
  Digital Omnibus deferred the *Annex III high-risk regime* to 2 Dec 2027 — it did **not**
  defer the prohibition.
- "Behind the Screens" (counterfactual bias study on AI video-interview assessment).
- Disability, neurodivergence, culture, lighting, camera position and facial structure all
  confound these signals.

**Not removed:** the tracker, or the feature. **Removed:** the *interpretation* of affect as
competence. Show framing, lighting, camera height, face-visible %, mic level, pauses, pace.
Do not show smile %, warmth %, tension %, or blink-as-nervousness.

Reframe: **"we run a 3D face tracker at 25 fps entirely in your browser, and we use it
exclusively to tell you your lamp is behind you."** Same technical flex, no liability.

### Do not oversell cloud as unsafe

Groq offers [Zero Data Retention](https://console.groq.com/docs/your-data) and does not train
on customer inputs. The honest, narrower, stronger claim:

> ZDR means *not retained*. On-device means *never left the laptop*. Only the second one
> satisfies the brief's literal wording.

---

## 5. Build order

Sequenced by dependency, not calendar. Irreducibly-human work is started early.

### 1. Remove liabilities — ✅ DONE (2026-10-03)
- Delete `score_bias` (`+8 / −8 / −5 / −3`). Same answer, same score, any interviewer.
- Strip affect interpretation from `SCORE_SYSTEM`: no warmth/tension/smile/nervousness.
- Reframe webcam as interview-logistics rehearsal only.
- `better_answer` → **evidence-preserving revision**. Only candidate's words + resume facts;
  gaps marked `[add metric]`, `[clarify your role]`; invents nothing.
- Trickster → advanced mode, not default.
- Update README (it currently publishes the bias table).
- *(added mid-task at user request)* Rename all five personas to professional, industry-standard
  names and regenerate the spoken greeting audio.

### 2. Résumé parse audit — ✅ DONE (2026-10-03)
Parse the PDF the way an ATS would (text extraction, reading order, field extraction, section
detection) and show **what the machine extracted** next to **what the candidate wrote**.
Two-column layouts, tables, headers/footers and text-in-images break parsers and most
candidates do not know. Every flag cites the specific parsing failure.

### 3. Transcript gate — ✅ DONE (2026-10-03)
Show the Whisper transcript **editable, before scoring**. Fix a word → rescore → score moves.
This is the strongest demo beat in the project: the only moment where the user sees Aria be
wrong and then be right.

### 4. Evidence-cited feedback — ✅ DONE (2026-10-03)
Every strength and every gap must quote a transcript span or a resume line, or be explicitly
labelled *general suggestion*. Substrate for 2 and 3.

### 5. On-device split — ✅ DONE (2026-10-03)

| Task | Runs on | Rationale |
|---|---|---|
| STT | **Groq Whisper (cloud)** — *reversed from the original plan, see below* | most accurate on accents |
| Résumé + JD parsing | **local** text extraction (PyMuPDF/OCR); cloud field extraction with local fallback | privacy-sensitive; extraction is easy |
| Rubric scoring | Groq default, **local Ollama fallback** | a 7B genuinely underperforms on nuanced rubric judgement |
| TTS | already local (Kokoro) | free credibility |
| Camera / vision | already local (MediaPipe, in-browser) | free credibility |

Framing that survives a knowledgeable judge: **"we use local where local is as good, and we
tell you exactly where it isn't."**

**Reversal (user-approved 2026-10-03): STT stays on Groq.** The original plan made local STT the
headline, but the product's whole thesis is that ASR mishears accents and the transcript gate
exists to fix it. A small local model is *less* accurate on accents than `whisper-large-v3-turbo`,
so local STT would make our own bias story worse and run slower. The honest position: cloud STT is
the accuracy/fairness choice, and the UI now says so. Local capability is delivered where it is a
real win — on-device extraction and audit, Kokoro TTS, browser vision, and a genuine offline LLM
fallback.

### 6. JD grounding + gap-driven questions — ✅ DONE (2026-10-03)
Paste-a-JD → **Requirement × Résumé evidence × Confidence × Question**. Questions are generated
*from the gaps*, not from a generic competency list. Bounded selection, not open-ended
autonomy — LLMs are weakest exactly there (Järvilehto 2026).

### 7. Continuity loop — ✅ DONE (7a ✅, 7b ✅, 7c ✅, 7d ✅)
- **7a ✅** SQLite, local, deletable, exportable. **Not Supabase** — the brief says on-device
  and data-secure; a hosted store of student résumés and verbatim transcripts contradicts it.
- **7b ✅** Retry the same question → side-by-side diff → what changed.
- **7c ✅** Per-competency history across sessions; weak competencies re-queued (spaced practice).
- **7d ✅** Confidence measured as behaviour chosen (answered → corrected → retried → improved),
  never read from a face; shown in the session summary and the progress panel.
- Removes persona score-bias as a side effect: the same answer scores the same for everyone,
  so retry loops are actually comparable.

**Confidence is measured as behaviour chosen** — answered → corrected → retried → improved.
Never inferred from the face. Rationale: young women report 56% AI-confidence vs 74% for young
men; a tool that shows you evidence you are competent answers that gap directly, and does so
without reading your face.### 8. Publish error bars — ✅ DONE (2026-10-03)

Originally specified as human hand-rating. **Revised (user decision 2026-10-03):** the product
is for the interviewee, so asking the candidate to rate Aria would be circular, and a manual
rating chore does not belong in a hackathon build. Validation is therefore **fully
automated** and needs no human input:

- **Discrimination (headline)** — on the benchmark's known weak/strong split, can Aria order a
  strong answer above a weak one? Reported as AUC per dimension. *Published: 1.00, no overlap.*
- **Reliability** — Aria scored every benchmark answer several times; publish the mean
  standard deviation and range of the *same* answer. This is the Rating Roulette point:
  disclose variance, do not fake determinism. *Published: mean SD 4.6, range 7.7.*
- **Convergent validity** — deterministic, hand-checkable text features (concrete numbers,
  "I" vs "we", STAR signposting, hedging) versus Aria's dimension scores (Spearman ρ), with each
  proxy checked for discriminativeness first so a broken yardstick cannot be used to indict the
  scorer. *Published: hedging supported (ρ −0.72), quantified numbers weakly supported (ρ 0.59),
  I/we ratio and STAR markers reported as not discriminative.*
- **Independent-judge agreement** — a second, *different* model (an on-device Ollama model)
  scores the same answers; report weighted Cohen's κ and Krippendorff's α. Not ground truth,
  a sanity check. *Published: κ 0.33, α 0.67, and the judge is ~13 points harsher.*

The numbers are surfaced **read-only** in the UI, never as a form. Per Rating Roulette the
fix is disclosure, not determinism — and this is still the cheapest credible differentiator,
because nobody else in the category publishes any validation at all.

---

## 6. Demo script (3 minutes)

1. **Upload résumé + paste JD** → watch the Requirement × Evidence map build.
2. **"Here's what the ATS actually read."** Two-column PDF becomes scrambled text. Physical
   reaction, not a feature list.
3. **"Here's what the mic heard."** Edit one wrong word → score visibly moves.
4. **Answer out loud.** Get evidence quotes and one priority fix. No number asserted without a
   citation.
5. **Retry the same question.** Side-by-side diff: what you added.
6. **"Here's what we refuse to score."** Smile, warmth, tension, blink, eye contact — with the
   EU AI Act Article 5 reference.
7. **Kill the wifi.** Local STT + parsing + TTS + vision still work.
8. **"Here's where we still need the cloud — and here's our agreement with human raters."**

---

## 7. Decisions taken

| Decision | Reasoning |
|---|---|
| Cut personalised learning resources | 1 of 7 objectives; the cheapest one; parse audit covers the ATS line of the brief more directly |
| Keep personas, **delete `score_bias`** | interviewer behaviour differences are real and defensible; silent score arithmetic is not. Personas anchored to documented interviewer types (phone screen, competency-based behavioural, technical deep-dive, systems design, structured panel) so they are citable rather than decorative |
| Keep webcam, remove affect readouts | strongest technical asset; show it, never score on it (§4) |
| **No Supabase** — local SQLite + export | contradicts "on-device AI / user data remains secure"; zero rubric points; auth and migrations cost a week |
| ATS **parse audit** yes, ATS **score** no | parse rate is reproducible; ATS scores are opaque even by their vendor's admission (§3.5) |
| Keep the GitHub/commit drill as documented future work | real market whitespace, off-brief here, demo-fragile (needs a token and public repos) |

---

## 8. Deliberately not building

- **GitHub / commit-grounded drilling** — off-brief, demo-fragile.
- **Real-time voice / barge-in** — engineering-heavy, scores against zero listed objectives.
  (Competitors use LiveKit/Pipecat; our turn-taking is push-to-talk. Note as future work.)
- **Open-ended autonomous interviewing** — LLMs are weakest in adaptive dialogue.
- **ESCO/O*NET skill normalisation, Kaggle-derived JD profiles** — off-brief polish.
- **Live-interview assistance** — violates employer rules, destroys positioning.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Local 7B scores worse → product feels dumber | cloud default; local is the opt-in offline demo path |
| Hand-rating 30 answers eats the week | 20 answers, 2 raters; start it early; it is the only irreducibly human work |
| "You're inferring emotion from a face" | already removed from scoring — that *is* the answer |
| "It's just an LLM wrapper" | published eval + offline demo + cited design decisions |
| Drift into "AI resume tool with voice" | thesis stated in sentence one; teammates all own a row of the objective map |
| Teammates build conflicting things | lock the objective → work map; every change traces to an objective |

---

## 10. Referenced sources

- [Girl Geeks 2026 — IEEE CS Bangalore Chapter](https://ieeecsbangalore.org/girl-geeks/)
- [DeepInterview](https://github.com/ngoanpv/DeepInterview) · [Interview Copilot](https://interviewcopilot.io/) · [Huru vs Final Round](https://huru.ai/compare/huru-vs-final-round-ai/) · [Resume Matcher](https://github.com/srbhr/Resume-Matcher)
- [Rating Roulette (arXiv 2510.27106)](https://arxiv.org/html/2510.27106) · [E-AVI (arXiv 2609.20001)](https://arxiv.org/abs/2609.20001) · [PhoenixNest-Video (arXiv 2609.02231)](https://arxiv.org/abs/2609.02231)
- [Järvilehto et al. 2026 (PMC12865673)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12865673/) · [Wingate et al. 2025](https://www.semanticscholar.org/paper/e621c0546dd64f120b65ae3290f94e5c78c57a6b) · [Kell et al. 2017 (BARS)](https://onlinelibrary.wiley.com/doi/full/10.1002/ets2.12152) · [Sackett et al. 2021](https://gwern.net/doc/statistics/meta-analysis/2021-sackett.pdf)
- [EU AI Act Article 5](https://artificialintelligenceact.eu/article/5/) · [AI Act timeline](https://artificialintelligenceact.eu/high-level-summary/) · [ADA.gov AI guidance](https://www.ada.gov/resources/ai-guidance/) · [Scribe and Prejudice? (Ada Lovelace Institute)](https://www.adalovelaceinstitute.org/report/scribe-and-prejudice/)
- [Maindidze et al. 2025, accent bias meta-analysis](https://onlinelibrary.wiley.com/doi/10.1111/ijsa.12519) · [ASR atypical-speech bias (arXiv 2601.18641)](https://arxiv.org/pdf/2601.18641)
- [AI resume builders tested 2026 (ATS Verification)](https://atsverification.com/blog/ai-resume-builders-tested-2026/) · [ATS myths debunked](https://www.kraftcv.com/blog/ats-myths-debunked-resume-rejected-2026) · [92% of recruiters: no auto-reject](https://resumegeni.com/blog/why-92-percent-recruiters-say-ats-doesnt-auto-reject)
- [Latimier et al. 2021, spaced retrieval meta-analysis](http://www.lscp.net/persons/ramus/docs/EPR20.pdf) · [Corral et al. 2025, retrieval and transfer](https://www.sciencedirect.com/science/article/pii/S0959475225001434)
- [Groq data retention](https://console.groq.com/docs/your-data)

---

## 11. Progress log

### Step 1 — Remove liabilities ✅ (2026-10-03)

**Backend**
- `backend/coach.py`: deleted `score_bias` from all five personas; the score is now the raw
  scorecard total, so the same answer scores the same for every interviewer.
- `SCORE_SYSTEM` no longer receives or interprets any camera metrics. It judges the words only,
  forbids inferring emotion/confidence, and requires every strength/improvement to quote the
  candidate's words or a resume fact (evidence rule).
- `better_answer` → `answer_revision`: the candidate's own answer tightened, with
  `[add metric]`-style placeholders where evidence is missing. The model is explicitly told to
  invent nothing.
- Delivery summary → `setup_summary` (framing/visibility only: face-visible %, facing-camera %,
  multi-face flags). Scoring never sees these numbers.
- `backend/server.py`: request field `delivery` → `setup`; `/api/interview/answer` passes it to
  `coach.score_answer(answer, setup=…)`.

**Frontend**
- `faceMetrics.ts`: added tested `headFacing()` (head-pose-only framing). `engagementFromPose`
  now delegates to it; all affect maths retained and still tested (14/14 pass).
- `useFaceAnalysis.ts`: now surfaces only setup metrics — `facing`, `yaw/pitch`, `faceCount`,
  fps, calibration. Smile, tension, blink rate, gaze/eye-contact and head steadiness are no
  longer computed into UI state, and `outputFaceBlendshapes` is disabled.
- `DeliveryMeter.tsx` → **`CameraSetup.tsx`**: framing/visibility panel with explicit copy that
  no emotion is read and nothing is scored.
- `InterviewView.tsx`: removed the warmth/tension/blink cells and the per-answer delivery score;
  added a camera-setup panel; `answer_revision` UI renamed to "evidence-preserving revision" with
  a note that Aria never invents a number.
- `useInterview.ts` / `App.tsx`: types, request body and wiring renamed to `setup`.

**Personas** (user request): renamed to professional names and regenerated the spoken greeting
`static/audio/persona_*.wav` (local, gitignored) so the audio says the new name.

| id | old name | new name | voice |
|---|---|---|---|
| `standard` | The Panel | **The Structured Panel** | `af_heart` |
| `strict` | The High-Bar Manager | **The Bar-Raiser** | `am_michael` |
| `kind` | The Kind Soul | **The Talent Coach** | `af_bella` |
| `rapid` | The Rapid-Fire Recruiter | **The Phone Screener** | `am_adam` |
| `crook` | The Trickster | **The Stress Interviewer** *(advanced mode)* | `bm_george` |

**Docs**: README persona table (bias column removed), README camera section, `DELIVERY-METRICS.md`
(affect-removal note), this log.

**Hotfix (same day):** the Talent Coach greeting still sounded like "The Kind Soul" — the file
on disk was correct (confirmed by transcribing `persona_kind.wav`), so the browser was serving a
cached copy of the unchanged URL. `persona_public()` and `/api/interview/persona` now append a
`?v=<mtime>` to the preset URL, so a regenerated greeting is never served from cache.

**Verification**: `node scripts/face-metrics-test.mjs` 14/14 pass; `npm run build` succeeds;
`npm run lint` totals unchanged (537 warnings / 3 errors, all pre-existing vendored `public/wasm`);
`python -c "import backend.coach, backend.server"` OK.

### Step 2 — Résumé parse audit ✅ (2026-10-03)

Deterministic (no LLM) ATS-style audit added to `backend/parsing.py` and stored in the session
`parse` object, so the same text the coach uses is what the audit reports on.

- **Layout**: two-column detection (block geometry), table count (`page.find_tables`), image
  count, and repeating header/footer detection across pages.
- **Content**: word/char/page counts, standard section detection (summary, experience,
  education, skills, projects, certifications, awards), and contact extraction (email, phone,
  LinkedIn).
- **Flags**: each flag has a severity, a plain-language explanation, and an evidence snippet
  (the longest extracted line — where column-splicing shows up). Covers scanned/image-only PDFs,
  two-column layouts, tables, repeating furniture, text-in-images, missing section headings,
  missing email, and encoding artefacts (`\ufffd`).
- **UI** (`InterviewView.tsx` → `ParseAuditPanel`): an "ATS parse audit" panel showing the flags,
  the *raw text the parser read* ("what the machine got"), section chips, and ATS-friendly fixes.
  This is also the brief's *"suggests improvements for ATS compatibility"* line, without shipping
  an ATS score.

**Verification**: `_extract_pdf` on a synthetic two-column, two-page PDF correctly reports
`columns=2`, the repeated footer, missing sections and missing email; plain-text audit and a full
`coach.load_resume` round-trip both return the audit in session state; build/lint/metrics unchanged.

### Step 3 — Transcript gate ✅ (2026-10-03)

A voice answer no longer goes straight from Whisper to scoring. `useInterview` now holds a
`pending` transcript; `App`'s router parks the transcript (and the camera-setup summary captured
at the end of speaking) instead of submitting.

- **`TranscriptGate`** (in `InterviewView.tsx`): shows "Here's what the mic heard" in an editable
  textarea, with **Score this answer** / **Discard**. It states plainly that this is the transcript
  Aria will score and that nothing is scored until confirmed, and flags when the text was edited.
- While the gate is open the in-app mic and the Space push-to-talk start are disabled, so you
  cannot record over an unconfirmed answer.
- Typed answers bypass the gate (the user already wrote them) — but if a gate is open, typing in
  the composer sends the typed text as the corrected answer.
- The camera-setup window is closed (`endTurn`) the moment the transcript arrives, so the setup
  metrics describe speaking time, not the editing time at the gate.

**Verification**: `npm run build` succeeds; `npm run lint` back to baseline (537/3, all vendored
`public/wasm`); `face-metrics-test.mjs` 14/14. No backend change was required — the gate reuses
`POST /api/interview/answer`.

### Step 4 — Evidence-cited feedback ✅ (2026-10-03)

Strengths, improvements and red flags are no longer bare strings. `SCORE_SYSTEM` now asks for
objects `{point, quote, source}` where `quote` must be copied **verbatim** from the answer
(`source: "answer"`) or the résumé (`source: "resume"`), or `source: "general"` when no verbatim
quote exists.

- **`backend/coach.py`**: `_evidence()` normalises the model output and **verifies every quote**
  with `_quote_in()` against the actual transcript / resume text (whitespace-insensitive, tolerant
  of surrounding quote marks and of a `...`-joined quote, but not of paraphrase). A claimed quote
  that cannot be found is **dropped** and the observation is re-labelled a general suggestion —
  Aria never presents a fabricated quote as evidence. Duplicates are removed; each list is capped
  at four.
- **UI**: each observation renders as a quote-styled line plus a source chip — *from your words* /
  *from your résumé* / *general suggestion*.

**Verification**: helper cases all correct (exact match accepted; paraphrase rejected;
`...`-join accepted only when **all** fragments are present; surrounding quote marks stripped).
A live scoring round-trip returned `source="answer", verified=true` items with verbatim quotes and
downgraded one unverifiable claim to `general`. Build/lint/metrics unchanged.

### Step 5 — On-device split ✅ (2026-10-03)

- `backend/brain.py`: added `complete()` — Groq first, then a **local Ollama fallback** when the
  cloud errors or no key is present (`OLLAMA_HOST`, `OLLAMA_MODEL`, default `llama3.2:3b`).
  `chat()` and `coach._json_call()` now go through it, so parsing and scoring survive offline.
- `backend/server.py`: `/api/health` returns an `engines` block (primary / fallback / last-used for
  STT, LLM, TTS, vision).
- `frontend/src/components/WhereItRuns.tsx`: a header panel listing each task with its engine and
  an honest `local / in-browser / cloud` badge, plus the reason.
- Docs: `.env.example` (OLLAMA vars), README "Where each step runs", SETUP troubleshooting.

**Verification**: with `GROQ_MODEL` set to a non-existent model, `brain.complete()` logged the cloud
failure and returned `engine="ollama"` with the text `"ok"` from the local server; `/api/health`
reported `llm_primary`, `llm_fallback`, `llm_last`. Build/lint at baseline. No model download and no
new dependency was required.

### Step 6 — JD grounding + gap-driven questions ✅ (2026-10-03)

- `backend/coach.py`: new `COVERAGE_SYSTEM` + `_coverage()` build a **Requirement × Résumé
evidence × Confidence** map from a pasted JD. Evidence is **verified verbatim** with `_quote_in()`;
a claimed match that cannot be quoted is downgraded to a gap, so the map never invents a match.
Each requirement carries `importance` (high/medium/low) and `confidence`
(strong/partial/gap/unknown).
- `_focus_lines()` does the **bounded selection**: highest-importance gaps first, then partials, then
strengths — capped at six. `_make_questions()` feeds that focus block into `QUESTION_SYSTEM`, so the
six questions probe the gaps (one each), then fill any remainder from the résumé.
- `load_resume(..., jd=...)` accepts the JD on upload; new `set_jd()` (and `POST /api/interview/jd`)
regrounds the questions before answering and clears any answers.
- **UI**: an optional JD box on the upload screen, plus a Job-description card that shows the
coverage map with an importance/confidence badge and the verbatim evidence quote per requirement,
and lets you reground before you start answering.

**Verification**: for a Senior Backend JD against a Python/PostgreSQL resume, the map reported
1 matched / 8 gaps and correctly flagged tenure, Kubernetes/Docker and Kafka as gaps; the six
generated questions each probed one of those gaps. `set_jd()` after an initial no-JD load rebuilt
the map, regenerated six gap-driven questions and cleared answers. Build/lint at baseline.

### Step 7 — Continuity loop (in progress)

**7a — local history store ✅ (2026-10-03)**
- `backend/store.py`: local SQLite at `aria_history.db` (gitignored, `ARIA_DB` override). Tables
  `sessions` and `answers` (`attempt`, `edited`, `score`, `breakdown`, verbatim `answer`).
- Writes are best-effort: a DB failure is logged and **never** breaks scoring or the interview.
- `coach.py` opens a history session on resume load and records every scored answer.
- Endpoints: `GET /api/history`, `GET /api/history/export`, `POST /api/history/import`,
  `POST /api/history/clear`, `GET /api/history/session/{id}`.
- `ProgressPanel.tsx`: behaviour stats (answered / corrected / retried / improved), per-competency
  history with trend arrows, recent sessions, and Export / Import / Delete — with an explicit
  "stored only on this device, never uploaded" note.
- Verified: store round-trip (sessions + avg, competency trend 40→72, weak detection, behaviour
  counts, export→clear→import); coach wiring writes a session + answer row; build/lint at baseline.

**7b — retry + what changed ✅ (2026-10-03)**
- **`backend/coach.py`**: scoring extracted into `_score_question()` so a first answer and a retry
  share the exact same rubric and maths. New `retry_answer(question_id, answer, setup, edited)`
  scores a second attempt **out-of-band** — it does not advance the question sequence and never
  overwrites attempt 1. Every record now carries its `question_id`.
- **Deterministic diff** (`_answer_diff`, `_retry_diff`): a word-level multiset comparison of the
  two transcripts plus the numeric tokens the retry added. This is arithmetic on the two answers,
  not a model's opinion, so "what changed" can never invent an addition that is not there — the
  same "Aria never invents a number" rule, applied to the diff.
- **`backend/store.py`**: `attempts_for(session, question)` so retries are numbered correctly
  (`attempt 2`, `3`, …) and the behaviour record shows a genuine retry.
- **`backend/server.py`**: `POST /api/interview/retry` + `ChatRequest.question_id`.
- **UI**: a retry button on each scorecard opens a `RetryCard` (voice or typed, same rubric);
  the result renders as a `RetryDiffBlock` on the original card — score before → after, the
  dimensions that moved, added/dropped words, and the numbers you added, tagged "numbers added".
- **Fixed a step-7a gap**: the transcript gate's `edited` flag is now actually sent through
  (`submitAnswer`/`confirmPending`), so the "corrected" behaviour stat is honest.
- Verified: helper unit checks (added/dropped words, numbers, dimension deltas); an end-to-end
  retry with the LLM stubbed — first attempt untouched, `attempt=2`, sequence unaffected,
  `behaviour={answered:2, retried:1, improved:1}`; clear 400s for "retry before answering" and
  "unknown question". Build OK, lint at baseline (537/3), face metrics 14/14.

**7c — spaced re-asking ✅ (2026-10-03)**
- `backend/coach.py`: `_weak_competencies()` reads `store.weak_competencies(threshold=60, limit=3)`,
  and `_make_questions()` injects a bounded **SPACED PRACTICE** block into `QUESTION_SYSTEM`
  (new `{weak}` token) asking for at least one question that targets a weak competency even when
  the résumé looks strong there. Any failure is swallowed — question generation never depends on
  the history DB.
- Honest scope documented in the prompt and code: spaced retrieval is supported (Latimier 2021)
  but transfer to a real interview is weaker than advertised (Corral 2025). Aria re-queues practice;
  it does **not** claim to predict hire outcomes, and it never touches the score.
- Verified with the LLM stubbed: no history → no spaced block; after seeding a 40/55/82 session the
  block lists `ownership` and `communication clarity` and excludes the strong competency.

**7d — confidence as behaviour ✅ (2026-10-03)**
- `backend/coach.py`: `_behaviour()` wraps `store.behaviour_stats()` (best-effort) and `state()`
  now includes a `behaviour` block; `retry_answer()` returns it too.
- `useInterview` carries `behaviour` into state; the session-complete card renders an **activity**
  block — answered / corrected / retried / improved — with the note "choices you made across your
  local practice history — never read from your face". The header `ProgressPanel` shows the same
  counters. Because 7b fixed the `edited` pass-through, all four counters are now genuine.
- Verified: `state().behaviour` exposes the five counters; build/lint at baseline (537/3).

**Step 7 complete.** All four continuity sub-features are in: local store (7a), retry + diff (7b),
spaced re-asking (7c), confidence-as-behaviour (7d).

### Step 8 — Published error bars (automated) ✅ (2026-10-03)

**Redesign note (user decision).** The original plan called for hand-rating ~30 answers with
2-3 human raters. That was rejected: the product is for the interviewee, so a candidate rating
Aria is circular, and a manual rating chore is not something the build should depend on. The
validation is now **fully automated and needs zero human input**.

- `docs/eval/eval_set.json`: a fixed, inspectable benchmark of **24 answers** (12 interview
  questions × one deliberately weak + one deliberately strong answer) so the agreement
  statistics have real spread.
- `backend/stats.py`: pure-NumPy agreement coefficients written from the definitions —
  weighted Cohen's κ (linear/quadratic), Krippendorff's α (nominal/ordinal/interval, with
  missing values), Spearman ρ, MAE, and repeated-measure spread. No new dependency.
- `backend/features.py`: deterministic, hand-checkable text features (numbers, quantified
  outcomes, I/we ownership ratio, STAR signals, hedges) plus the validity hypotheses.
- `backend/errorbars.py`: assembles the report — **reliability** (Aria vs itself), **convergent
  validity** (features vs dimensions), **independent-judge agreement** (a different, on-device
  Ollama model vs Aria). `judge_scores()` drives the local model; nothing runs in the request
  path.
- `scripts/errorbars.py`: the offline developer CLI — `score` (Aria N times each), `judge`
  (independent model), `analyze` (writes `docs/eval/error-bars.json`), `status`. No export/
  import of human scores.
- `GET /api/eval/error-bars` + `ValidationPanel.tsx`: the numbers are shown **read-only** in the
  header, with an explicit "no human rating is needed or requested" note and the caveats.
- Store: `eval_runs.source` separates Aria's runs from the judge's; no personal data involved.

**Methodology fix found by running it.** The first real run reported `contradicted` for the
ownership and structure hypotheses. Inspecting the data showed the fault was the **proxy**, not
Aria: the deliberately weak answers say “I” at least as often as the strong ones, and the STAR
keyword regex matched almost nothing, so neither feature could separate the benchmark. Correlation
against a yardstick that cannot measure is meaningless, so `convergent()` now checks each proxy's
own discriminativeness first and reports **“proxy not discriminative”** instead of indicting the
scorer. `stats.auc()` was added for that check, and `discrimination()` (AUC of strong vs weak,
per dimension) became the headline measure.

**Published results** (real runs, `docs/eval/error-bars.json`):

| Measure | Result |
|---|---|
| **Discrimination** | AUC **1.00** (weak mean 15.1 vs strong 78.1, **no overlap**); per dimension 0.96–1.00 |
| **Reliability** | mean SD **4.57**, mean range **7.71** across re-runs of the identical answer |
| **Convergent validity** | hedging vs evidence ρ = **−0.72** (supported); quantified numbers ρ = **0.59** (weakly supported); I/we ratio and STAR markers reported as not discriminative |
| **Independent judge** (`llama3.2:3b`, on-device) | weighted κ **0.328** (fair), α **0.674**, mean gap **21.2** pts, level delta **−12.6** |

Read together these say something more useful than a single accuracy number: Aria **orders**
answers almost perfectly, but its absolute score carries ~±5 points of genuine run-to-run noise,
and a small on-device model is far harsher. That is precisely why the product leads with cited
evidence and ordering rather than a lone uncalibrated number.

**Verification**: stats hand-checked (κ linear 0.8718 / quadratic 0.9474, nominal α 0.125) plus
300 random coincidence-vs-direct α cross-checks per metric; features/errorbars end-to-end with
stubbed models and then against **real model runs** (24 answers × 2–3 Groq runs + 24 local judge
runs); `status` CLI; schema migration for an older local DB; build OK; lint at baseline (537/3).

**Remainder**: the final documentation pass (README / SETUP / requirements), per the user.