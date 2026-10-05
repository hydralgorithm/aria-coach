# Learning System — design and loop

## The loop (PS objectives 5, 6)

```
resume + JD ──► coverage map (Requirement × Evidence × Confidence)
     │                    │
     │             gaps (high-importance requirements with no verbatim evidence)
     ▼                    ▼
interview answers ──► scored attempts (technical / behavioral rubrics)
     │                    │
     │             weak competencies (avg < 60 from the local history DB)
     ▼                    ▼
learning plan (per gap: why → evidence → resource → practice task → drill → re-test)
     │
     ▼
re-test (new session / retry) ──► readiness components update ──► plan re-forms
```

Every arrow is implemented and traceable: `backend/insights.py` builds the
plan and readiness; `backend/store.py` supplies the memory; `/api/progress`
measures improvement arithmetically from stored attempts; the frontend renders
the loop (`InsightsPanels.tsx`) **in the interview flow itself** instead of
hiding it in a dashboard the student never opens.

## Where the loop is actually rendered

Once the last question of the session is answered, without a refresh and with
no debug panel:

```
SESSION COMPLETE          average, practice habits, camera setup
  ↓
READINESS SNAPSHOT        explainable components, "not yet measured" listed
  ↓
TOP WEAKNESSES            top 3, each citing the answer or resume line behind it
  ↓
PERSONALIZED LEARNING PLAN  per item: priority · topic · effort ·
                          "Recommended because:" · Origin: · Evidence: ·
                          Do this: · Mini drill: · resource (curated) ·
                          Re-test: · "Re-test this now" when it maps to an
                          answered question
  ↓
RE-TEST: PREVIOUS VS TARGET   real stored before → after per question
  ↓
FULL S/W/O REPORT        collapsed, plus the claim probes
```

Mid-session the readiness and plan panels also stay live below the question, so
the candidate can watch the plan re-form after every answer — that is the
"rebuilds from just-answered session data without a refresh" requirement, made
visible rather than promised.

`frontend/scripts/learning-plan-smoke.mjs` drives this exact path in a real
browser (upload → JD → every question → the ordered panels → a real re-test
delta) and fails if the plan is not on screen.

## Where the plan comes from (priority order)

1. **JD gaps first** — a high-importance requirement with `confidence: gap` or
   `unknown` in the coverage map. The `why` line quotes the requirement and
   states the evidence absence.
2. **Measured weak competencies** — from `store.competency_history()`, any
   competency averaging under 65 across the candidate's real attempts (this
   session's answers are already persisted when `state()` rebuilds the plan).
3. **Unsupported resume claims** — quantified claims that an interviewer will
   probe; the drill trains the baseline/measurement/trade-off answer.
4. **Default** — if no gaps are identifiable yet, one honest item tells the
   candidate to run a session with a JD so the plan can re-form from evidence.

## Resource policy

- Resources come **only** from `backend/resources.py` — a fixed, curated
  catalog of 17 stable, official, well-known sources with provider, difficulty,
  estimated time, verified date, and an **offline alternative** for each.
- Matching is keyword-based and deterministic (`recommend_for`): exact topic →
  alias table → safe default. Anyone can trace why a resource was recommended.
- **The model never invents a URL.** Tests assert every catalog URL is HTTPS
  and every plan item references the catalog.

## Item schema (what the student sees)

```
topic · priority (critical/important/optional) · estimated_effort
why            rendered as "Recommended because: …" (their gap, quoted)
evidence       rendered as "Evidence: …", or the honest
               "none on file — that absence is the reason this is here"
origin         rendered as "Origin: from the job description" /
               "measured from your attempts" /
               "from an unproven resume claim" / "no specific gap found"
resource {title, provider, url, time, difficulty, offline_alternative}
practice_task  → "Do this:"
mini_drill     → "Mini drill:" (3 questions, 60 s each)
retest         → "Re-test:" + a "Re-test this now" button when the item maps to
                 an answered question scored on that competency
```

## Session length

One interview is `coach.INTERVIEW_LENGTH` questions — 6 by default, overridable
with `ARIA_INTERVIEW_LENGTH`. The prompt, the truncation and the number shown in
the UI header all read that one constant (`state()["interview_length"]`); there
is no second literal anywhere.

## Honesty rules

- Plans are generated from *the candidate's* gaps; the generic
  "learn DSA + system design + communication" is the thing this replaces.
- Nothing converts an inference into a fact: measured weaknesses cite the
  attempt history; JD gaps cite the coverage map; resume observations quote
  verbatim spans.
- The readiness number the loop feeds is labelled *practice readiness* —
  never a hiring prediction — and components without evidence print
  "no evidence yet" instead of a guess.
- **No gap is an answer, not a blank screen.** When nothing is missing, the
  plan says exactly that: every JD requirement had evidence, no competency
  scored below the bar, no quantified claim left unsupported.
- The re-test loop reports only stored numbers. `previous 47 → now 66 (+19)` is
  arithmetic on the two stored attempts; a worse retry renders as a negative
  delta, and the smoke test asserts `delta == after - before` so a boast cannot
  be printed by accident.
