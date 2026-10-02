# Aria — Voice Interview Coach

Aria is a local-first interview-practice app. It supports a conversational
voice mode and a resume-grounded interview coach with spoken questions,
rubric-based scoring, and optional webcam delivery analysis.

This is a working prototype, not a production service:

- The LLM and speech-to-text requests go to Groq and require an API key.
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
| Delivery analysis | MediaPipe Face Landmarker in the browser |
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

### Interviewer personas

Each persona changes the prompts, scoring bias, and Kokoro voice. A persona can
be changed before or during a session.

| Persona | Style | Voice | Bias |
| --- | --- | --- | ---: |
| **The Panel** | Balanced, structured interview | `af_heart` | 0 |
| **The High-Bar Manager** | Demanding and evidence-focused | `am_michael` | -8 |
| **The Trickster** | Adversarial, with mild traps | `bm_george` | -5 |
| **The Kind Soul** | Supportive mentor with hints | `af_bella` | +8 |
| **The Rapid-Fire Recruiter** | Concise first-round screening | `am_adam` | -3 |

### Webcam delivery analysis

In interview mode, **Delivery analysis (camera)** uses MediaPipe locally to
track engagement, facial expression, head pose, blink rate, face visibility,
and multiple faces. Each answer can include a delivery score and notes, and
the final report aggregates delivery across the session.

The metrics are calibrated to the candidate's neutral pose and deliberately
do not punish normal reading posture. The pure metric functions and regression
checks live in [`frontend/src/lib/faceMetrics.ts`](frontend/src/lib/faceMetrics.ts)
and `frontend/scripts/face-metrics-test.mjs`. See
[`DELIVERY-METRICS.md`](DELIVERY-METRICS.md) for the audit and rationale.

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
| `POST` | `/api/interview/resume` | Parse a resume and create questions |
| `POST` | `/api/interview/persona` | Switch the active interviewer |
| `POST` | `/api/interview/answer` | Score an answer and return the next question |
| `GET` | `/api/interview/state` | Read the current interview session |
| `POST` | `/api/interview/reset` | Reset interview state |

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
