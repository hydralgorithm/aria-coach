# Delivery (camera) metrics — flaws found and fixes applied

This documents a full audit of the webcam delivery analysis: what was wrong, the
evidence, and what changed. Written for an AI agent or a reviewer who wants to
know *why* the code looks the way it does, and to catch regressions.

Everything still runs on-device. No video leaves the browser.

---

## The two reported symptoms

1. **"Eye contact" showed as low even while looking at the centre of the
   screen**, and only went up when staring directly into the lens.
2. **Blink rate showed as exceptionally high at times.**

Both were real bugs, not misconfiguration. Symptom 1 was caused by two
independent defects compounding; symptom 2 by three more.

---

## Root cause 1 — the eye-contact metric punished reading

### 1a. The pitch falloff reached zero at 20°

The old formula scored engagement from head pitch like this:

```ts
const pitchFactor = Math.max(0, 1 - Math.max(0, Math.abs(pitchDeg) - 6) / 14)
```

A full linear ramp from 6° to **20°**, then hard zero. Reading a question on a
monitor means tilting your head down roughly 15–25°. So the metric hit exactly
zero for the single most normal thing a candidate does.

Yaw was worse in practice: `yawFactor` hit zero at 22°, and `YAW_TOLERANCE` /
`PITCH_TOLERANCE` (14°/12°) flagged "gaze aversion" using head pose **only**,
ignoring the eyes entirely.

Measured on a realistic reading posture (head 4° off-axis, 18° down, eyes
converged on the screen): **eye contact scored 0.129.**

### 1b. `eyeLookIn`/`eyeLookOut` were summed instead of decomposed

The old gaze term was:

```ts
const gazeDev = (eyeLookOutLeft + eyeLookOutRight + eyeLookInLeft + eyeLookInRight) / 4
```

This is wrong twice over:

- **`In` and `Out` are opposing directions for a given eye.** Summing them
  destroys the sign — the formula could not distinguish looking left from
  looking right. Confirmed as the known weak point in
  [TouchDesigner forum discussion](https://forum.derivative.ca/t/gaze-detection-help-mediapipe-tox-torin-blankensmith/731801),
  where a developer using exactly these eight values reports erratic results and
  is advised to use iris landmarks instead.
- **Focusing on something nearby makes both eyes rotate inward.** That vergence
  is correct, desirable near-focus behaviour, but the formula charged it as
  "looking away". Reading a 50 cm screen therefore looked like gaze aversion on
  top of the pitch collapse.

### 1c. The advice given was wrong

The generated note said *"look into the lens as if it were the interviewer"*.
In a real video interview the camera is normally beside or near the screen, and
the accepted guidance is to look at the **interviewer and the questions on your
screen**, using the lens for emphasis — not to stare at it. Penalising natural
screen-reading produced both a wrong number and bad coaching.

### Fixes

| Change | Detail |
|---|---|
| Widen and re-shape the falloff | Flat "engaged" plateau out to 22° yaw / 20° pitch, then a *linear ramp to zero* at 50°/45°. No cliff edge. |
| Decompose the two eyes properly | `lateral = (hL - hR) / 2` (differential → genuine side gaze), `vergence = (hL + hR) / 2` (common mode → near focus). Vergence is reported but **never penalised**. |
| Discount vertical eye movement | Weighted `0.12` vs `0.35` for lateral. Looking down to read is expected behaviour. |
| Calibrate to the user's neutral pose | A laptop webcam sits ~15–20° above the screen, so "looking at the interviewer" is not a zero pitch. The first ~24 frames learn a baseline (ignoring outliers past 35°) and all pose maths is measured relative to it. |
| Reframe the metric | Renamed **engagement**. Sustained turning away is the signal; glancing at notes is not. The advice text was rewritten. |

Same reading posture, new code: **0.958** (was 0.129). Genuine aversion — head
turned 46° away — still scores **0.143**, so the metric did not simply go
permissive.

---

## Root cause 2 — the blink rate was invented from short windows

### 2a. Division by a very small `seconds`

```ts
const seconds = Math.max(0.5, (performance.now() - acc.start) / 1000)
const bpm = Math.round((blinkTimesRef.current.length / seconds) * 60)
```

Three blinks in a 2-second window reported as **90 blinks/min** — the "exceptionally
high at times" symptom. The 0.5 s floor meant even a brief turn could not avoid a
nonsense figure.

### 2b. No refractory period → one blink counted several times

Hysteresis alone (`on 0.5 / off 0.25`) still re-arms on every noisy crossing of
the threshold. At 15 fps a blink (100–400 ms) spans only 2–6 samples, so a single
blink reliably produced multiple rising edges. In the test, one noisy blink
sequence counted **3 times** instead of 1.

### 2c. The live panel showed a count, not a rate

`metrics.blinksPerMin` was assigned the raw length of a trailing 60-second array
— a *count*, displayed with a `/min` unit. It disagreed with the final report and
was meaningless in the first minute.

### 2d. The threshold ignored what the person was doing

Blink rate is strongly task-dependent. Published figures: **~17/min at rest,
~26/min in conversation, ~4.5/min while reading.** A single fixed ">35/min =
nervousness" rule penalises someone who is reading their questions, which is
precisely what candidates are asked to do.

### Fixes

| Change | Detail |
|---|---|
| Refractory period | `BLINK.refractoryMs = 250` — one human blink cannot complete faster, so onsets inside that window are ignored. One noisy blink now counts **1**. |
| Raise the sampling rate | Detect interval 66 ms → **40 ms (~25 fps)**, so a short blink is sampled reliably instead of being missed or double-counted. |
| Require a meaningful window | `blinkRate()` returns **`null`** below 15 s of observation instead of a wild number. |
| Clamp | Capped at 90/min — beyond that it is a detection artefact, not physiology. |
| Honest live value | The panel shows the true rate over the observed window, or `—` until there is enough data. |
| Task-aware framing | Only clearly above **40/min** (the conversational range) is flagged, and the note now quotes the ~26/min conversational baseline for context. |
| Threshold documented | The reasoning lives in `BLINK` in `faceMetrics.ts` with citations, so it is not re-tuned blindly. |

---

## Other defects found and fixed

| # | Defect | Fix |
|---|---|---|
| 3 | **Typed answers skipped delivery analysis entirely.** `beginTurn()` was only called on the voice path, so `endTurn()` reported whatever window happened to exist. | `beginTurn()` now fires on composer focus, `endTurn()` on send — typed answers are measured over the span they were composed. |
| 4 | **Wall-clock time was used while frames stop in a hidden tab.** `requestAnimationFrame` is throttled to a stop when the tab is backgrounded, but `seconds` kept counting, diluting engagement and inflating the blink rate. | Time is accumulated from *observed* frame gaps only (`MAX_GAP_MS` cap), so backgrounded time is excluded. |
| 5 | **A second face could hijack the metrics.** `numFaces: 2` but blendshapes and the transform matrix were always read from index `0`; if a second person became the larger detection, metrics jumped frame to frame. | The nearest nose to the previously tracked one is followed, so identity is stable. |
| 6 | **15 React re-renders per second.** `setMetrics` fired every detected frame. | UI flushes at 5 Hz; detection still runs at 25 Hz. |
| 7 | **Gaze aversion counted single-frame flickers.** One frame of noise could start an "away" run. | Requires 6 consecutive off-axis frames before it counts. |
| 8 | **Dead accumulator.** `eyeContactSum` was summed every frame and never used. | Replaced by `meanEngagement`, which is now reported. |
| 9 | **The maths was untestable.** All of it lived inside a React hook closure. | Extracted to `src/lib/faceMetrics.ts` as pure functions with a test suite. |
| 10 | **The LLM was told to judge "eye contact".** It would have kept reasoning about lens-staring and about a `null` blink rate reading as zero. | `SCORE_SYSTEM` now explains calibration, reading-vs-looking-away, and that `null` means "not enough data". Verified: with `blinksPerMin: null` it raised no blink-related note. |

---

## Verifying the fixes

```bash
cd frontend
node scripts/face-metrics-test.mjs
```

14 checks. Each states the old formula's result next to the new one, so the
original regressions stay documented and cannot silently return:

```
=== 1. Reading the question on screen (the reported bug) ===
  eye contact while reading: old=0.129  new=0.958
=== 2. Genuine gaze aversion is still caught ===
  head turned 46 deg away: old=0     new=0.143
=== 4. Blink: one blink must count once ===
  single noisy blink: old counted 3, new counted 1
=== 5. Blink rate is not invented from a short window ===
  3 blinks / 2.0s  -> old=90/min  new=null
=== 6. Camera mounted above the screen is calibrated out ===
  head 32 deg down: uncalibrated=0.498  calibrated=0.958
All delivery-metric checks passed.
```

> The test caught two genuine errors **in the new code** during development —
> the lateral/vergence terms were initially swapped. It is deliberately written
> so the maths can be checked rather than trusted.

---

## What the metrics mean now

| Metric | Meaning | Not |
|---|---|---|
| **engagement** | Share of the answer spent oriented toward the interviewer, calibrated to your own neutral pose. | "How hard are you staring into the lens" |
| **warmth** | Smile intensity over time. | Forced smiling |
| **tension** | Brow furrow / lip press. | Judgement of your competence |
| **blinks/min** | Rate over the observed window, or `—` if the answer was too short. | A score for short answers |
| **steadiness** | Head movement variance about your baseline. | "Move less" — some movement is natural |

### Practical guidance

- **Position the camera near eye level**, ideally beside or just above the
  screen. The closer it is to where you look, the less you have to compromise.
- **Look at the interviewer and the questions on your screen.** That is correct
  and is no longer penalised. Use the lens for emphasis when you finish a point.
- A short answer shows `blinks —` rather than a fabricated rate. This is
  deliberate.

### Limitations worth being honest about

- Webcam-based gaze is an **estimate from head pose and eyelid geometry**, not
  an eye tracker. It cannot know where you are really looking, only where your
  face is pointing. Treat it as a posture coach, not a lie detector.
- Lighting and camera placement dominate accuracy. A dim room or a low-angle
  camera will skew posture readings more than anything the maths can fix.
- The neutral-pose baseline needs a second or two of visible face to learn. It
  shows "calibrating…" until then, and results are less trustworthy during that
  window (`calibrated: false`).
- **This is not a hiring decision tool.** It is a practice aid. No facial metric
  here is suitable for assessing a real candidate, and the app should not be
  used that way.

---

## Files touched

| File | Change |
|---|---|
| `frontend/src/lib/faceMetrics.ts` | **New.** Pure, tested metric maths and tuning constants with documented rationale. |
| `frontend/scripts/face-metrics-test.mjs` | **New.** 14 checks covering every regression above. |
| `frontend/src/hooks/useFaceAnalysis.ts` | Rewritten to use the module; fixes blink rate, observed-time accounting, face identity, aversion persistence and render throttling. |
| `frontend/src/components/DeliveryMeter.tsx` | "eye contact" → "engagement"; honest blink display; calibration status. |
| `frontend/src/components/InterviewView.tsx` | Field names and labels updated. |
| `frontend/src/hooks/useInterview.ts` | Summary type updated. |
| `frontend/src/App.tsx` | Typed answers now get a delivery window. |
| `coach.py` | Summary fields renamed; `SCORE_SYSTEM` taught how to read the new numbers. |

### References

- [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) — blendshape and transformation-matrix outputs.
- [TouchDesigner forum: gaze detection with MediaPipe `eyeLook*`](https://forum.derivative.ca/t/gaze-detection-help-mediapipe-tox-torin-blankensmith/731801) — averaging these eight values is unreliable.
- [Abusharha et al., 2017 (PMC6118863)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6118863/) — normal spontaneous blink rate 12–15/min.
- [Analysis of blink rate patterns in normal subjects](https://www.academia.edu/13960174/Analysis_of_blink_rate_patterns_in_normal_subjects) — ~17/min at rest, ~4.5/min while reading, ~26/min in conversation.
- [Dewi & Chen, 2022 (PMC9044337)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9044337/) — blink detection thresholds; blink duration 100–400 ms.