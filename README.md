# Aria — Voice Interview Coach

Aria is a local-first interview-practice app. It supports a conversational
voice mode and a resume-grounded interview coach with spoken questions,
rubric-based scoring, and an optional on-device camera setup check.

This is a working prototype, not a production service:

- The LLM and speech-to-text requests go to Groq by default and require an API
  key. When the cloud is unreachable, the LLM falls back to a local Ollama model
  if one is running.
- Text-to-speech runs locally with Kokoro ONNX.
- Session state is held in memory; there is no account, database, or
  multi-user isolation.
- Browser camera analysis stays on the device. Video is not uploaded.

## Current stack

| Area | Technology |
| --- | --- |
| Web UI | React 19, Vite 8, TypeScript, Tailwind CSS v4 |
| API | FastAPI + Uvicorn |
| LLM | Groq `qwen/qwen3.8-27b` by default; configurable with `GROQ_MODEL` |
| Speech-to-text | Groq `whisper-large-v3-turbo` |
| Text-to-speech | Kokoro ONNX, local CPU inference |
| Resume parsing | PyMuPDF text extraction with Tesseract OCR fallback |
| Camera setup check | MediaPipe Face Landmarker in the browser |
| Browser checks | Puppeteer scripts in `frontend/scripts/` |

## Features

### Free chat

Talk to Aria using the browser microphone, or type in the composer. Aria
transcribes the turn, sends it to the LLM, and plays the response aloud.
Press **Space** or tap the microphone while Aria is speaking to barge in.
**New session** clears the chat history.

### Resume-based interview coach

Switch to **Interview coach**, choose an interviewer, and upload a PDF or text
resume. Aria extracts resume facts, generates six tailored questions, and
scores each answer out of 100 across:

- structure and evidence (STAR/SOARA)
- impact and ownership
- clarity and self-awareness
- red flags and an HR insight

The session ends with the average score and a summary of the areas to improve.
Scanned PDFs are sent through local Tesseract OCR when they have no usable text
layer.

An **evidence-preserving revision** shows the candidate's own answer tightened,
with `[add metric]`-style placeholders where a fact is missing. Aria never
invents a number, employer or outcome.

Voice answers stop at a **transcript gate**: Aria shows exactly what the mic
heard, editable, and scores nothing until you confirm. Fix a misheard word and
the score reflects your corrected words — the one moment where you can watch
Aria be wrong, and then be right.

Every strength, improvement and red flag is an **evidence item**: a quoted span
from your answer or résumé, or an explicit *general suggestion*. Aria verifies
each quote against the transcript or resume and drops it if it cannot be found —
it never presents a fabricated quote as evidence.

Paste a **job description** (on upload, or before you start answering) and Aria
builds a **Requirement × Evidence × Confidence** map: each requirement the JD
states, the verbatim résumé line that supports it, and whether it reads as a
strong match, a partial match, or a gap. The six questions are then generated
*from the gaps* — bounded, grounded selection rather than open-ended autonomy.

### Practice history & retries

Aria keeps a **local practice history** in a single SQLite file
(`aria_history.db`, gitignored; set `ARIA_DB` to relocate it). It stores the
questions, answers and score breakdowns so you can see per-competency trends and
weak spots across sessions. Nothing is uploaded — the header's **Your progress**
panel can export, import or delete it.

**Confidence is measured as behaviour, not read from a face:** answered →
corrected → retried → improved. Both the progress panel and the end-of-session
summary show those counts and say plainly where the numbers come from.
**Weak competencies are re-queued** as spaced practice in your next session —
practice scheduling from your own history, never a prediction about hiring.

**Retry any question.** A retry is scored out-of-band: the first attempt is kept
and Aria shows a side-by-side diff — score before → after, which scorecard
dimensions moved, and a word-level comparison of what you added or dropped
(including any numbers you added). That comparison is arithmetic on the two
transcripts, not a model's opinion, so every change is checkable.

### Published validation

Aria publishes how trustworthy its own scores are. Validation is **automatic and
needs no human rating** — the candidate practising is never asked to grade Aria
(that would be circular). Three measures, produced offline by
`scripts/errorbars.py` over a fixed 24-answer benchmark
([`docs/eval/eval_set.json`](docs/eval/eval_set.json)):

- **Reliability** — Aria scores every benchmark answer several times, and we
  publish the spread of the *same* answer. The fix for noisy scorers is
disclosure, not fake determinism.
- **Convergent validity** — deterministic text features (concrete numbers, "I"
  vs "we", STAR signposting, hedging) versus Aria's dimension scores. If the
  evidence score does not rise when a candidate adds real evidence, we say so.
- **Independent-judge agreement** — a second, different model (on-device Ollama)
  scores the same answers; weighted Cohen's κ and Krippendorff's α are reported.

The header's **Published validation** panel shows the numbers read-only.

```powershell
python scripts/errorbars.py score --repeats 3   # Aria vs itself
python scripts/errorbars.py judge               # independent local model
python scripts/errorbars.py analyze             # writes docs/eval/error-bars.json
```

### Interviewer personas

Each persona changes the interviewer's behaviour, questions, and Kokoro voice.
A persona can be changed before or during a session. Personas never change the
score — the same answer scores the same for every interviewer.

| Persona | Style | Voice |
| --- | --- | --- |
| **The Structured Panel** | Balanced, competency-based interview | `af_heart` |
| **The Bar-Raiser** | High-bar and evidence-obsessed | `am_michael` |
| **The Talent Coach** | Supportive coaching round with hints | `af_bella` |
| **The Phone Screener** | Fast first-round screen | `am_adam` |
| **The Stress Interviewer** *(advanced)* | Adversarial round with mild traps | `bm_george` |

### Camera setup check

In interview mode, **Camera setup check** runs MediaPipe locally to verify
interview logistics: are you in frame, is your head oriented toward the camera,
and is anyone else visible. It never reads emotion and it never affects the
score — per EU AI Act Article 5(1)(f), Aria does not infer how you feel from
your face. Smile, warmth, tension and blink readouts were deliberately removed.

The framing maths is calibrated to the candidate's neutral pose so normal
screen-reading posture is not penalised. The pure metric functions and
regression checks live in
[`frontend/src/lib/faceMetrics.ts`](frontend/src/lib/faceMetrics.ts) and
`frontend/scripts/face-metrics-test.mjs`. See
[`DELIVERY-METRICS.md`](DELIVERY-METRICS.md) for the audit and rationale.

### Where each step runs

Aria is explicit about the split — `/api/health` reports it, and the header's
**Where this runs** panel shows it live.

| Task | Runs on | Why |
| --- | --- | --- |
| Speech-to-text | Groq Whisper (cloud) | most accurate on accents; the transcript gate exists because any ASR can mishear |
| Résumé text extraction | on-device (PyMuPDF / Tesseract) | the raw text never leaves the machine |
| Field extraction & scoring | Groq (cloud), local Ollama fallback | a small local model genuinely underperforms on rubric judgement |
| Text-to-speech | on-device (Kokoro) | free credibility |
| Camera setup check | in-browser (MediaPipe) | no video ever leaves the device |
| Parse audit & evidence checks | on-device, deterministic | reproducible, not sampled |

Set `OLLAMA_MODEL` (default `llama3.2:3b`) and keep Ollama running to use the
offline fallback: when the cloud is unreachable, parsing and scoring continue
locally. The active engine is shown in `/api/health` (`engines.llm_last`).

## Quick start

For a complete fresh-machine setup, including Python, Node.js, ffmpeg,
Tesseract, Kokoro model weights, and Windows troubleshooting, follow
[`SETUP.md`](SETUP.md).

The short version is:

1. Install Python 3.12, Node.js 20+, ffmpeg, and (for scanned PDFs) Tesseract.
2. Create and activate a virtual environment:

   ```powershell
   py -3.12 -m venv .venv
   .venv\Scripts\Activate.ps1
   ```

3. Install backend dependencies and configure Groq:

   ```powershell
   pip install -r requirements.txt
   copy .env.example .env
   ```

   Set `GROQ_API_KEY` in `.env`. Optionally set `GROQ_MODEL`; the default is
   `qwen/qwen3.8-27b`.

4. Download `models/kokoro-v1.0.onnx` and `models/voices-v1.0.bin` by following
   the model step in [`SETUP.md`](SETUP.md).
   The model files are intentionally ignored by Git.
5. Build the frontend:

   ```powershell
   cd frontend
   npm install
   npm run build
   cd ..
   ```

6. Start the API and web UI:

   ```powershell
   .venv\Scripts\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8000 --reload
   ```

   On Windows, double-click [`START.bat`](START.bat)
   instead; it configures the Python DLL and package paths before starting
   Uvicorn.

7. Open <http://127.0.0.1:8000>.

The API exposes a health check at
<http://127.0.0.1:8000/api/health>. It reports the active Groq model and
whether the Kokoro files are available.

## CLI mode

The original terminal conversation is still available:

```powershell
python main.py          # microphone conversation
python main.py --text   # keyboard-only conversation
```

Use `/reset` for a new conversation. Press `Ctrl+C` and confirm with `y` to
quit.

## Verification

Run these from `frontend/`:

```powershell
npm run build
npm run lint
node scripts/face-metrics-test.mjs
```

The browser-driven checks require a Chromium executable and a running backend:

```powershell
node scripts/mic-test.mjs http://127.0.0.1:8000
node scripts/face-test.mjs http://127.0.0.1:8000 path\to\resume.pdf
```

`mic-test.mjs` uses a fake microphone. `face-test.mjs` uses a fake camera and
expects a Y4M face-video fixture; set `CHROME_PATH`, `FAKE_MIC_FILE`, and
`FAKE_VIDEO` when the defaults do not match your machine. The other probes in
`frontend/scripts/` inspect the raw audio/video paths.

## API surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Backend and model diagnostics |
| `POST` | `/api/transcribe` | Convert browser audio to text |
| `POST` | `/api/chat` | Chat with Aria |
| `POST` | `/api/reset` | Reset free-chat history |
| `GET` | `/api/personas` | List interview personas |
| `POST` | `/api/interview/resume` | Parse a resume (and optional JD) and create questions |
| `POST` | `/api/interview/jd` | Ground the questions in a pasted job description |
| `POST` | `/api/interview/persona` | Switch the active interviewer |
| `POST` | `/api/interview/answer` | Score an answer and return the next question |
| `POST` | `/api/interview/retry` | Re-answer a question; returns the attempt diff |
| `GET` | `/api/interview/state` | Read the current interview session |
| `POST` | `/api/interview/reset` | Reset interview state |
| `GET` | `/api/history` | Local practice history (sessions, competencies, behaviour) |
| `GET` | `/api/history/export` | Export the local history as JSON |
| `POST` | `/api/history/import` | Import a history export |
| `POST` | `/api/history/clear` | Delete the local history |
| `GET` | `/api/history/session/{id}` | Read one stored session |
| `GET` | `/api/eval/error-bars` | Published validation numbers (read-only) |

## Architecture

```text
Chrome
  ├─ microphone (MediaRecorder webm/opus)
  │    └─ POST /api/transcribe ── Groq Whisper
  ├─ text ─────────────────────── POST /api/chat
  │                                 └─ Groq LLM
  └─ interview resume/answers ──── POST /api/interview/*
                                    ├─ PyMuPDF / Tesseract
                                    ├─ Groq LLM
                                    └─ Kokoro ONNX ── wav

Chrome ◀────────── FastAPI serves frontend/dist and static/audio
```

The backend reuses `backend/brain.py` and `backend/tts.py` for both the web
application and CLI. Interview orchestration and scoring live in
`backend/coach.py`; document extraction lives in `backend/parsing.py`.

## Troubleshooting

- **Microphone transcription fails:** install ffmpeg and restart the terminal.
  The backend also accepts `FFMPEG_BINARY` as the full path to `ffmpeg.exe`.
- **Responses fail with a Groq model error:** set `GROQ_MODEL` in `.env` to a
  model available to your Groq account, then restart the backend.
- **No spoken response:** check `/api/health`, confirm both Kokoro model files
  exist, and use the browser's manual **Play reply** control if autoplay was
  blocked.
- **Scanned resume cannot be read:** install the Tesseract binary in addition
  to the Python `pytesseract` package.
- **Camera unavailable:** grant camera permission and verify that Chromium can
  access the selected device. Camera analysis is optional; interview scoring
  still works without it.

See [`SETUP.md`](SETUP.md) for
platform-specific installation and detailed diagnostics.
