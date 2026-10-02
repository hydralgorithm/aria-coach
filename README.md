# Aria — Voice Conversation Coach (v0)

Step 1 toward the full resume-analysis interview coach: a bot that holds a
**spoken conversation** using only free resources.

| Part | Tech | Cost |
|---|---|---|
| Brain | Groq Cloud — `openai/gpt-oss-120b` | free tier (1 free API key) |
| Speech-to-text | Groq — `whisper-large-v3-turbo` | same free key |
| Text-to-speech | Kokoro-82M (local, on this PC) | free, offline |

## One-time setup

1. Create a free account at <https://console.groq.com> (no credit card).
2. Create an API key (Dashboard → API Keys) and copy it.
3. `cp .env.example .env` and paste your key into `.env`.
4. Install deps (Python 3.12 venv):

```bash
source .venv/bin/activate
uv pip install -r requirements.txt
```

5. Test TTS offline (downloads Kokoro model ~350MB on first run):

```bash
python tts.py
```

## Run — Web UI (React + FastAPI)

```bash
# 1. build the frontend (once, and after any frontend change)
cd frontend && npm install && npm run build && cd ..

# 2. start the backend (serves the UI + API on one port)
source .venv/bin/activate
uvicorn backend.server:app --port 8000

# 3. open http://localhost:8000 in Chrome
```

Tap the mic and speak — Aria listens, thinks, and answers out loud.
Or type in the input box. "New session" resets the conversation.

### Modes

- **Free chat** — open conversation with Aria (voice or text). Barge-in:
  tap the mic or press Space while she talks to cut in.
- **Interview coach** — pick an interviewer personality, upload a resume
  (PDF/TXT, scanned PDFs are OCR'd), and answer 6 tailored questions out loud.
  Each answer is scored on a real HR scorecard: structure (STAR), evidence,
  impact/ownership, clarity and self-awareness, plus red flags and an HR
  insight per question. Progress chips show scores; the session average appears
  at the end.

### Interviewer personalities

Each mode changes the question style, the spoken voice, and the scoring
severity (score bias applied to the scorecard):

| Mode | Style | Voice | Score bias |
|---|---|---|---|
| **The Panel** | balanced structured interview | af_heart | 0 |
| **The High-Bar Manager** | evidence-obsessed, challenges vague claims | am_michael | −8 |
| **The Trickster** | leading questions, mild traps, tests composure | bm_george | −5 |
| **The Kind Soul** | supportive mentor, hints, second chances | af_bella | +8 |
| **The Rapid-Fire Recruiter** | fast screen: notice period, salary, headline win | am_adam | −3 |

Switch personality before uploading or mid-session — the interviewer
acknowledges the switch in their new voice.

### Delivery analysis (webcam)

In interview mode, **Delivery analysis (camera)** runs facial-expression and
head-pose tracking on-device with MediaPipe Face Landmarker (52 blendshapes +
facial transform). Nothing is uploaded — video never leaves the machine, only a
numeric summary per answer.

Live panel shows eye contact, warmth, tension, head yaw/pitch, blink rate and
fps, and warns when no face or more than one face is in frame. Each scored
answer gains a **delivery score** and notes, and the session end adds an
averaged delivery report (eye contact, warmth, tension, face-visible %).

Assets are self-hosted: `frontend/public/models/face_landmarker.task` and
`frontend/public/wasm/` (MediaPipe runtime). Headless test:

```bash
cd frontend
# needs a Y4M video containing a face (Chrome's fake camera)
ffmpeg -y -loop 1 -i face.png -t 2 -r 30 -vf scale=480:360 -pix_fmt yuv420p /tmp/face2.y4m
node scripts/face-test.mjs http://127.0.0.1:8000 /tmp/resume.pdf
```

### Resume parsing

`parsing.py` extracts text with PyMuPDF (layout aware), and falls back to
Tesseract OCR when a PDF has no text layer (scanned resumes). The extracted
text is then structured by the LLM into facts — experience, skills, education,
quantified achievements, likely probe areas — which is what actually drives the
questions, so they stay grounded in the real resume.

### Mic diagnostics

Press **D** (or the bug icon in the header) for a live panel showing mic
level vs. speech threshold, session id, recorder state, permission state,
and an event log — use it when a voice turn misbehaves.

## Run — Terminal (classic CLI)

```bash
python main.py          # voice conversation
python main.py --text   # keyboard only (no mic)
```

Commands during chat: `/reset` starts a fresh session, Ctrl+C then `y` quits.

## Troubleshooting audio

**No sound from Aria / mic flaky.** Check which devices Linux is routing to —
a Bluetooth headset set as the default sink *and* source is the classic
culprit (HFP mode often goes silent for playback and unreliable for capture):

```bash
pactl get-default-sink; pactl get-default-source
pactl list short sinks; pactl list short sources
# test playback (exit 124 = the route is hung/blocked)
timeout 10 paplay /path/to/any.wav; echo $?
# switch to the built-in speakers + internal mic
pactl set-default-sink   alsa_output.pci-0000_65_00.6.analog-stereo
pactl set-default-source alsa_input.pci-0000_65_00.6.analog-stereo
```

To keep using the headset for output, put the card back in stereo mode
(`a2dp-sink`) instead of `headset-head-unit`.

**Voice turns never end / mic seems dead.** Open the diagnostics panel (**D**)
and watch `level` vs `threshold`. If the level stays at 0.000 the audio graph
is starved — the app falls back to a fixed 6 second window automatically
(panel shows `analyser: FLAT — fixed window`).

**Browser blocked playback.** A `▶ Play reply` button appears in the composer
— click it, or click anywhere in the page first.

### Automated mic test (no human needed)

```bash
cd frontend && node scripts/mic-test.mjs http://127.0.0.1:8000
```

Launches Chromium with a fake microphone fed from a WAV file, drives the real
UI, and prints the in-app debug event log. `scripts/mic-probe.mjs` inspects the
raw audio graph (analyser vs. decoded recording loudness).

## Architecture

```
Chrome ──mic (MediaRecorder webm/opus)──▶ FastAPI /api/transcribe
        ──text─────────────────────────▶ FastAPI /api/chat
                                            ├─▶ Groq gpt-oss-120b (LLM)
                                            └─▶ Kokoro-82M local (TTS) → wav
Chrome ◀──audio element playback────────────┘
```

Frontend: React + Vite + Tailwind v4 + shadcn-style components + motion.
Backend reuses the same `brain.py` / `tts.py` modules as the CLI.

The interview coach lives in `coach.py` (resume text extraction via pypdf,
question generation, and rubric-based answer scoring) and exposes:

```
POST /api/interview/resume   multipart file -> profile + 6 questions + intro audio
POST /api/interview/answer   {message} -> score, feedback, next question, audio
GET  /api/interview/state    current session snapshot
POST /api/interview/reset    clear the session
```
