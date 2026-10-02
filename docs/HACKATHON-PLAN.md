# Aria — Girl Geeks 2026 Hackathon Plan

**Event:** IEEE Computer Society Bangalore Chapter — Girl Geeks 2026 (8th edition, national level)
**Use case:** Official Use Case 01 — "AI-Powered Resume & Interview Coach"
**Status:** strategy locked, implementation not started

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

### 1. Remove liabilities
- Delete `score_bias` (`+8 / −8 / −5 / −3`). Same answer, same score, any interviewer.
- Strip affect interpretation from `SCORE_SYSTEM`: no warmth/tension/smile/nervousness.
- Reframe webcam as interview-logistics rehearsal only.
- `better_answer` → **evidence-preserving revision**. Only candidate's words + resume facts;
  gaps marked `[add metric]`, `[clarify your role]`; invents nothing.
- Trickster → advanced mode, not default.
- Update README (it currently publishes the bias table).

### 2. Résumé parse audit
Parse the PDF the way an ATS would (text extraction, reading order, field extraction, section
detection) and show **what the machine extracted** next to **what the candidate wrote**.
Two-column layouts, tables, headers/footers and text-in-images break parsers and most
candidates do not know. Every flag cites the specific parsing failure.

### 3. Transcript gate
Show the Whisper transcript **editable, before scoring**. Fix a word → rescore → score moves.
This is the strongest demo beat in the project: the only moment where the user sees Aria be
wrong and then be right.

### 4. Evidence-cited feedback
Every strength and every gap must quote a transcript span or a resume line, or be explicitly
labelled *general suggestion*. Substrate for 2 and 3.

### 5. On-device split

| Task | Runs on | Rationale |
|---|---|---|
| STT | **local** (faster-whisper / whisper.cpp) | only place cloud *actively harms* the user |
| Résumé + JD parsing | **local** | privacy-sensitive; extraction is easy for a 7–8B |
| Rubric scoring | Groq default, local fallback | a 7B genuinely underperforms on nuanced rubric judgement |
| TTS | already local (Kokoro) | free credibility |
| Camera / vision | already local (MediaPipe, in-browser) | free credibility |

Framing that survives a knowledgeable judge: **"we use local where local is as good, and we
tell you exactly where it isn't."**

### 6. JD grounding + gap-driven questions
Paste-a-JD → **Requirement × Résumé evidence × Confidence × Question**. Questions are generated
*from the gaps*, not from a generic competency list. Bounded selection, not open-ended
autonomy — LLMs are weakest exactly there (Järvilehto 2026).

### 7. Continuity loop
- SQLite, local, deletable, exportable. **Not Supabase** — the brief says on-device and
  data-secure; a hosted store of student résumés and verbatim transcripts contradicts it.
- Retry the same question → side-by-side diff → what changed.
- Per-competency history across sessions; weak competencies re-queued (spaced practice).
- Removes persona score-bias as a side effect: the same answer scores the same for everyone,
  so retry loops are actually comparable.

**Confidence is measured as behaviour chosen** — answered → corrected → retried → improved.
Never inferred from the face. Rationale: young women report 56% AI-confidence vs 74% for young
men; a tool that shows you evidence you are competent answers that gap directly, and does so
without reading your face.

### 8. Publish error bars
- Hand-rate ~30 answers (2 raters, ideally 3).
- Report agreement with human raters per dimension — Cohen's / Krippendorff's, not raw
  correlation.
- Report Aria's own **intra-rater variance** across 3 identical runs of the same answer.
- Surface both numbers in the UI, not just the README.

Per Rating Roulette, the fix is disclosure, not determinism. **This is the item most likely to
be squeezed under time pressure and the one most likely to win.** Protect it.

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