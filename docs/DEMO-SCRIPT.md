# Demo Script — 3 minutes, deterministic, judge-proof

**Setup before the audience arrives**

```bash
# 1. start Ollama (offline LLM path) and pre-pull the model
ollama serve &            # if not already running as a service
ollama pull llama3.2:3b

# 2. warm the local whisper model so the offline STT is instant
ARIA_OFFLINE=1 python -c "from backend import brain; brain._get_whisper()"

# 3. build + start
cd frontend && npm run build && cd ..
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

Have open: the resume PDF (with one quantified claim), the JD text in a editor,
and a second browser tab already on the app (for the isolation demo).

## The 3 minutes

**0:00 — Upload (15 s).** Interview coach tab → upload the resume with a JD
pasted. While the "Analysing resume…" spinner runs: *"Parsing happens on this
machine — PyMuPDF and Tesseract. The raw PDF text never leaves the laptop."*

**0:15 — What the machine actually read (30 s).** Open the parse audit panel.
Show the raw extracted text and one flagged issue. *"No invented ATS score —
ATS vendors admit their own scores aren't comparable. This is what we can
prove: exactly what a parser receives, and what may break."*

**0:45 — Role gap map (30 s).** Show Requirement × Evidence × Confidence.
Point at one **gap**: *"The JD requires this; the resume can't quote a single
line for it. A claimed match without a verifiable quote is downgraded to a gap
— by code, not by hope."*

**1:15 — Strengths / Weaknesses / Opportunities (20 s).** Every card cites a
verbatim line. Show one `[add metric]` opportunity: *"If a stronger bullet
needs a fact the student hasn't given us, we print a placeholder. We never
hand them a fabricated number."*

**1:35 — Answer one question (30 s).** Speak (or type) a weak answer to a
technical question. Score appears labelled **Technical rubric** — correctness &
approach, reasoning & depth, trade-offs & alternatives, clarity of explanation,
edge cases & limits. Click the mic-heard transcript, mishear-fix one word,
**Re-score** → before → after.

**1:55 — The plan is already live (10 s).** Do *not* wait for the end: the
readiness snapshot and the learning plan are on screen under the question, and
they re-form after every answer. *"No refresh, no hidden panel — this is the
same plan object the completion view shows."*

**2:05 — Session complete → learning plan (25 s).** Answer the rest. When the
last question lands, scroll once. The order is deliberate: **SESSION COMPLETE →
READINESS SNAPSHOT → TOP WEAKNESSES → PERSONALIZED LEARNING PLAN → resources +
drills + re-test → previous/target score → retry action.** Open the first plan
item. *"Recommended because: the job description lists Go as high importance,
and your resume shows no evidence of it. Origin: from the job description.
Evidence: none on file — that absence is the reason it is here. The resource is
from our curated catalog; the model never writes a URL. And 'no gaps found'
is a real answer too — the plan says what it checked and found clean."*

**2:30 — Kill the Wi-Fi (25 s).** Turn off Wi-Fi. Answer one more question by
voice — faster-whisper transcribes locally, Ollama scores, Kokoro speaks.
Open **Where this runs**: every row shows a local engine. *"The problem
statement says on-device. We can prove which parts are, live, with the network
unplugged — and we tell you exactly what uses the cloud when it's on."*

**2:55 — Close (5 s).** *"Everything you just saw — scores, evidence, history —
is computable by hand. That's the product: a coach that shows its work."*

## Pre-planned fallbacks

| Failure | Recovery |
|---|---|
| Mic permission blocked | Type the answer — same scoring path, say "typed mode is a first-class fallback, not a degradation" |
| Ollama slow on first offline answer | The answer already pre-warmed; if not, talk over the spinner: "loading a local 3B model" |
| Upload rejected | That's the validation working — show the docx message as a feature |
| Browser audio blocked | The UI shows a Play-reply button; click it |

## Judge-question cheat sheet

1. **"ChatGPT + PDF?"** → The orchestration is deterministic: coverage maps,
   bounded question selection, evidence verification, truth guard, retry diff —
   none of which a chat window does, and all of which are unit-tested.
2. **"What's agentic?"** → The loop: gaps → questions → answers → measured
   weaknesses → learning plan → re-test → updated readiness. State changes
   from evidence, not from open-ended LLM autonomy. It re-forms **inside** the
   interview — the plan on screen after the last answer was rebuilt from the
   six answers the candidate just gave.
3. **"Why trust the score?"** → You don't have to. `docs/eval/error-bars.json`
   publishes its own error bars (mean SD ±4.6), and the eval set notes label
   discrimination AUC a regression test, not validation. Technical and
   behavioural questions are scored against two *different* published rubrics,
   defined once and mirrored frontend/backend with a test that fails on drift.
4. **"Fabricated claims?"** → Truth guard demo: any number in the model's
   revision that isn't in the candidate's words or resume becomes `[add metric]`.
5. **"What leaves the laptop?"** → Named per task in Where this runs; with
   `ARIA_OFFLINE=1` the cloud calls are skipped before they're constructed.
6. **"Did the learning plan actually show up, or is it in a report you never
   open?"** → It is in the interview flow, after the last question, without a
   refresh. `node scripts/learning-plan-smoke.mjs` drives that exact path in a
   real browser — upload, JD, every question, the ordered panels, a clickable
   catalog resource, a visible drill, and a re-test whose `+19` is arithmetic on
   the two stored attempts (the smoke test asserts `delta == after - before`).
