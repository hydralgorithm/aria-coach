# Aria — Setup Guide

**Audience:** an AI agent (or human) setting this project up from a fresh clone.
Follow the steps **in order**. Every step has a **Verify** command and the exact
expected output. **If a Verify fails, stop and use Troubleshooting — do not
continue to the next step.**

Total time: ~15 minutes, dominated by the PyTorch and npm downloads.

---

## 0. What this project is

Aria is a **voice-based interview practice coach**. You talk to it; it listens,
answers out loud, and scores your interview answers against a real HR scorecard.

| Part | Tech | Runs on | Cost |
|---|---|---|---|
| Brain (LLM) | `openai/gpt-oss-120b` via Groq | Groq cloud | free tier |
| Speech-to-text | `whisper-large-v3-turbo` via Groq | Groq cloud | same free key |
| Text-to-speech | Kokoro-82M | **locally** | free, offline |

**The only local model is Kokoro-82M** (text-to-speech, ~350 MB, downloaded
automatically from HuggingFace on first run). The LLM and STT are Groq cloud
calls, so a **Groq API key is required** — you cannot run this offline.

Architecture:

```
Chrome ──mic (MediaRecorder webm/opus)──▶ FastAPI /api/transcribe
        ──text─────────────────────────▶ FastAPI /api/chat
                                            ├─▶ Groq gpt-oss-120b (LLM)
                                            └─▶ Kokoro-82M local (TTS) → wav
Chrome ◀──<audio> playback───────────────────┘
```

---

## 1. Prerequisites

You need **all four** of these before starting.

| Tool | Version | Why |
|---|---|---|
| Python | **exactly 3.12.x** | torch/Kokoro wheels; 3.13+ is not tested here |
| Node.js | 20+ (22/24 fine) | builds the React frontend |
| ffmpeg | any recent | decodes browser mic audio in `server.py` |
| Git | any | cloning (only if you didn't already download the zip) |

### Windows

> **Use winget, not Chocolatey, for ffmpeg.** Chocolatey needs an elevated
> admin shell and fails with `Access to the path 'C:\ProgramData\chocolatey\...'
> is denied` in a normal terminal. winget installs per-user and just works.

```powershell
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
```

### macOS

```bash
brew install ffmpeg
```

### Linux (Debian/Ubuntu)

```bash
sudo apt update && sudo apt install -y ffmpeg python3.12 python3.12-venv build-essential
# espeak-ng is NOT needed — Kokoro bundles its own phonemizer binary.
```

**Verify (all platforms):**

```bash
ffmpeg -version | head -1     # expect: ffmpeg version 9.x  (or 6.x/7.x on mac/linux)
node --version                # expect: v20.x or higher
```

> **Windows note:** after installing ffmpeg you must **open a new terminal** —
> the current one has a stale `PATH`. If `ffmpeg` still isn't found, the binary
> lives at
> `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\<ver>\bin`
> — add that `bin` folder to your `PATH`.

---

## 2. Get a Groq API key (free, no credit card)

1. Sign up at <https://console.groq.com>.
2. Dashboard → **API Keys** → **Create Key**.
3. Copy it. It starts with `gsk_`.

Never commit this key. It goes in `.env`, which is already git-ignored.

---

## 3. Create the virtual environment

```bash
git clone <this-repo> aria-coach
cd aria-coach
python3.12 -m venv .venv          # Windows Git Bash:  py -3.12 -m venv .venv
```

Activate it:

| Shell | Command |
|---|---|
| Windows PowerShell | `.venv\Scripts\Activate.ps1` |
| Windows cmd.exe | `.venv\Scripts\activate.bat` |
| macOS / Linux bash | `source .venv/bin/activate` |

> **Windows gotcha — use 3.12 explicitly.** `python` on many Windows machines is
> 3.13 or 3.14, which has no matching torch/Kokoro wheels and fails to build.
> If `python --version` is not 3.12.x, do **not** use `python` — use
> `py -3.12` (Windows) or `python3.12` (macOS/Linux).

**Verify:**

```bash
python --version        # MUST print Python 3.12.x
```

If it prints 3.13/3.14, you activated the wrong interpreter. Deactivate and redo.

---

## 4. Install PyTorch

**Use the CPU build.** Kokoro-82M is small and synthesizes *faster than
real-time* on a normal laptop CPU (measured: 7.3 s of audio generated in 5.7 s).
Do not download the ~2.5 GB CUDA build unless you have a specific reason.

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

<details>
<summary>Optional: use an NVIDIA GPU instead</summary>

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu124
```

Torch then auto-detects the GPU. There is **no code change needed** — the model
moves to CUDA on its own. Expect ~2.5 GB download and noticeably faster synthesis.
Requires a recent NVIDIA driver. On a 6 GB card this model uses well under 1 GB.
</details>

**Verify:**

```bash
python -c "import torch; print(torch.__version__)"   # expect: 2.x.x+cpu
```

---

## 5. Install the Python dependencies

```bash
pip install -r requirements.txt
```

This installs `groq`, `kokoro`, `misaki`, `transformers`, `sounddevice`,
`fastapi`, `uvicorn`, `pymupdf`, `pypdf`, `pytesseract` and their dependencies.

> Two installs happen automatically *later*, on first real run — they need
> internet that first time:
> `en-core-web-sm` (spacy English model, pulled by `misaki`) and the Kokoro
> weights from HuggingFace.
>
> **You do NOT need to install espeak-ng.** `misaki[en]` depends on
> `espeakng-loader`, which bundles the phonemizer binary. Installing a separate
> system espeak-ng is a common and unnecessary source of trouble.

**Verify:**

```bash
python -c "import kokoro, groq, fastapi, soundfile, pymupdf; print('deps OK')"
```

---

## 6. Configure the API key

```bash
cp .env.example .env          # Windows PowerShell:  copy .env.example .env
```

Open `.env` and paste your key:

```
GROQ_API_KEY=gsk_your_actual_key_here
```

**Verify (must print `True`):**

```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print(os.getenv('GROQ_API_KEY','').startswith('gsk_'))"
```

---

## 7. Build the frontend

The backend serves the React app as static files from `frontend/dist`, so it must
be built **before** the first server start (and again after any frontend change).

```bash
cd frontend
npm install
npm run build
cd ..
```

**Verify:**

```bash
ls frontend/dist/index.html     # must exist
```

---

## 8. Download and verify the Kokoro model

The weights download automatically on first use. Trigger it now so failures
surface during setup rather than mid-conversation:

```bash
python -c "
from kokoro import KPipeline
import numpy as np
p = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')
for r in p('Aria is ready. Let us practice.', voice='af_heart'):
    a = getattr(r, 'audio', None)
    if a is None: continue
    if hasattr(a, 'detach'): a = a.detach().cpu().float().numpy()
    a = np.asarray(a, dtype=np.float32)
print('KOKORO OK: %.2fs of audio generated' % (len(a)/24000))
"
```

**Expected:** `KOKORO OK: 2.0-4.0s of audio generated`.
First run takes ~50 s (download); later runs ~15 s (model load).

> **Harmless warnings you can ignore:**
> `cache-system uses symlinks by default ... does not support them` — cosmetic on
> Windows. Silence it with Developer Mode on, or set
> `HF_HUB_DISABLE_SYMLINKS_WARNING=1`.
> `unauthenticated requests to the HF Hub` — fine for a public model.
> `weight_norm is deprecated`, `dropout option adds dropout...` — upstream noise.

---

## 9. Verify the whole backend

```bash
python -c "
import asyncio, server
from fastapi.testclient import TestClient
c = TestClient(server.app)
print('GET  /api/personas        ->', c.get('/api/personas').status_code)
print('GET  /api/interview/state ->', c.get('/api/interview/state').status_code)
print('POST /api/chat            ->', c.post('/api/chat', json={'message':'Say hi in one short sentence.'}).status_code)
"
```

**Expected:** `200`, `200`, `200`. All three must be `200` — that proves the
Groq key, the LLM, and local TTS all work together.

A `502` from `/api/chat` means the Groq key is wrong or unset.

---

## 10. Run it

> **You must run this from the project root** — the folder containing
> `server.py` (the same folder as `requirements.txt`), **not** from inside
> `frontend/`. `server.py` resolves `static/` and `frontend/dist` as relative
> paths, so the working directory decides whether it can find anything at all.

```bash
# 1. go to the project root (the folder holding server.py)
cd ~/aria-coach                   # Windows PowerShell:  cd C:\Users\<you>\Desktop\aria-coach

# 2. activate the venv
source .venv/bin/activate         # Windows PowerShell:  .venv\Scripts\Activate.ps1

# 3. start the server
python -m uvicorn server:app --port 8000
```

Open **<http://localhost:8000>** in Chrome.

- Tap the mic and speak, or type in the input box.
- **New session** resets the conversation.
- Interview mode: pick an interviewer personality, upload a resume (PDF/TXT),
  and answer 6 tailored questions out loud.
- Barge-in: tap the mic or press Space while Aria talks to cut in.
- Press **D** for the live mic diagnostics panel.

### Terminal mode (no browser)

Also from the **project root**:

```bash
python main.py            # voice conversation (needs a mic)
python main.py --text     # keyboard only, no mic needed
```

`/reset` starts a fresh session.

---

## 11. Interviewer personalities

| Mode | Style | Voice | Score bias |
|---|---|---|---|
| **The Panel** | balanced structured interview | af_heart | 0 |
| **The High-Bar Manager** | evidence-obsessed, challenges vague claims | am_michael | −8 |
| **The Trickster** | leading questions, mild traps, tests composure | bm_george | −5 |
| **The Kind Soul** | supportive mentor, hints, second chances | af_bella | +8 |
| **The Rapid-Fire Recruiter** | fast screen: notice period, salary, headline win | am_adam | −3 |

Switch persona before uploading a resume, or mid-session — the interviewer
acknowledges the switch in their new voice.

### Delivery analysis (webcam)

In interview mode, **Delivery analysis (camera)** runs facial-expression and
head-pose tracking **on-device** with MediaPipe Face Landmarker (52 blendshapes
+ facial transform). **Nothing is uploaded — video never leaves the machine**,
only a numeric summary per answer.

The live panel shows eye contact, warmth, tension, head yaw/pitch, blink rate and
fps, and warns when no face or more than one face is in frame. Each scored
answer gains a **delivery score**; the session end adds an averaged report.

Assets are self-hosted and already committed:
`frontend/public/models/face_landmarker.task` and `frontend/public/wasm/`.

---

## 12. Troubleshooting

### `Error loading ASGI app. Could not import module "server"`

You are in the **wrong directory**. `server.py` sits in the project root, so
uvicorn cannot import it from inside `frontend/`.

Check your prompt — it must end with the project root, not `...\aria-coach\frontend`:

```powershell
PS C:\Users\<you>\Desktop\aria-coach>          # correct
PS C:\Users\<you>\Desktop\aria-coach\frontend> # wrong
```

Fix:

```powershell
cd C:\Users\<you>\Desktop\aria-coach
python -m uvicorn server:app --port 8000
```

This matters beyond the import error: `server.py` reads `static/` and
`frontend/dist` as **relative** paths, so even if it imported you would get
`RuntimeError: Directory 'frontend/dist' does not exist` and no audio.

### `ffmpeg` not found — "Transcription failed"

`server.py` shells out to `ffmpeg` to convert browser webm/opus to 16 kHz mono
WAV for Whisper. Without it **the microphone is dead but typing still works**.

This version of the backend reports the real cause instead of a generic
"is the backend running?", so you will see:

> Transcription failed — ffmpeg was not found on PATH, so browser microphone
> audio cannot be decoded…

**The usual cause on Windows: the server was started in a terminal that was
open *before* ffmpeg was installed.** Installing it adds it to `PATH`, but a
terminal **inherits its PATH from whatever launched it**, so only processes
started afterwards get the new value. Restarting the server in the same tab
does *not* help, and an IDE terminal (VS Code, Cursor, Antigravity) inherits the
IDE's PATH — so it stays stale until the IDE itself is restarted.

**This version searches the usual Windows install locations as a fallback**, so
mic audio works even from a terminal with a stale PATH. If you still hit it,
set `FFMPEG_BINARY` explicitly:

```powershell
# PowerShell — put your real path here
$env:FFMPEG_BINARY = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"
```

Or fix the PATH properly — launch a **brand-new terminal window from the Start
menu** (not a new tab in an existing one):

```powershell
cd C:\Users\<you>\Desktop\aria-coach
.\.venv\Scripts\Activate.ps1
ffmpeg -version          # MUST work BEFORE starting the server
python -m uvicorn server:app --port 8000
```

Confirm what the server itself sees (this is the check that actually matters):

```bash
python -c "import server; print(server._ffmpeg())"
```

Verify the full conversion path:

```bash
ffmpeg -y -loglevel error -i any.wav -ac 1 -ar 16000 out.wav && echo OK
```

### "scoring failed: no current question — upload a resume first"

You sent a message while in **Interview** mode before uploading a resume, so
there is no question to score the answer against. Either upload a resume
(PDF/TXT) first, or switch back to **Free chat** mode.

Note the interview session lives in backend memory: restarting the server or
pressing **New session** clears it, so you will need to re-upload the resume.

### `UnicodeEncodeError: 'charmap' codec can't encode character`

Windows consoles default to `cp1252`. Printing model output containing smart
punctuation (`'` `—` `–` `‑`) crashes the CLI.

**Already fixed in `main.py`** (stdout is reconfigured to UTF-8 on start). If you
hit this in a one-off script, set:

```bash
PYTHONIOENCODING=utf-8 python your_script.py     # bash
$env:PYTHONIOENCODING="utf-8"; python your_script.py   # PowerShell
```

### `401 Invalid API Key` / `502` from `/api/chat`

`.env` is missing or wrong. Confirm:

```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); k=os.getenv('GROQ_API_KEY',''); print('len', len(k), 'gsk' if k.startswith('gsk_') else 'BAD')"
```

The key must start with `gsk_` and have no quotes or trailing spaces.

### Rate limits / `429`

The Groq free tier is rate-limited per minute. Wait ~60 s. For higher limits,
create more than one key and swap them in `.env`.

### No sound from Aria

The app plays audio through the **browser**, not the system output device, so
test the browser first. If the page shows no reply audio, click the
**▶ Play reply** button in the composer or click anywhere on the page first —
browsers block autoplay until the page is interacted with.

For the **terminal** mode, `sounddevice` uses the OS default device. On Windows,
check with:

```bash
python -c "import sounddevice as sd; print(sd.default.device)"
```

**Bluetooth headsets are the classic culprit.** A headset set as both input and
output often drops into Hands-Free (HFP) mode, which is silent for playback and
unreliable for capture. Switch the default to built-in speakers + internal mic.

### Voice turns never end / mic seems dead

Open the diagnostics panel (**D**) and watch `level` vs `threshold`. If `level`
stays at `0.000` the audio graph is starved — the app falls back to a fixed 6 s
window automatically (panel shows `analyser: FLAT — fixed window`).

### Scanned PDF resume reads as empty

`parsing.py` uses PyMuPDF first and falls back to Tesseract OCR for image-only
PDFs. Tesseract needs the **separate system binary** (unlike espeak-ng, which is
bundled):

```bash
# Windows
winget install --id UB-Mannheim.TesseractOCR -e
# macOS
brew install tesseract
# Debian/Ubuntu
sudo apt install -y tesseract-ocr
```

Then add the Tesseract folder to `PATH` if it isn't found automatically. Text-based
PDFs and `.txt` files need none of this.

### Python version is 3.13/3.14

Torch and the Kokoro stack are pinned to 3.12 here. Recreate the venv with 3.12
(§3) and reinstall (§4–§5).

### Frontend shows a blank page

`frontend/dist` is missing or stale:

```bash
cd frontend && npm install && npm run build && cd ..
```

During frontend development, run the Vite dev server alongside the backend:

```bash
cd frontend && npm run dev
```

---

## Appendix: how the backend is organised

```
Chrome ──mic──▶ /api/transcribe ──▶ ffmpeg → 16 kHz mono WAV → Groq Whisper
Chrome ──text─▶ /api/chat        ──▶ Groq LLM → Kokoro TTS → .wav → /static/audio/
```

| File | Role |
|---|---|
| `server.py` | FastAPI app; all `/api/*` endpoints, ffmpeg decode, static serving |
| `brain.py` | Groq LLM + Whisper client |
| `tts.py` | Kokoro-82M wrapper (`get_pipeline()`, `speak()`) |
| `coach.py` | Interview personas, resume → questions, rubric scoring |
| `parsing.py` | PDF text extraction (PyMuPDF) with Tesseract OCR fallback |
| `audio.py` | CLI mic capture → 16 kHz WAV, with adaptive silence detection |
| `main.py` | Terminal CLI loop |

### API reference

```
POST /api/transcribe            raw webm/opus body → {text}
POST /api/chat                  {message} → {reply, audio_url}
POST /api/reset                 clear conversation history

GET  /api/personas              interviewer personalities + active
POST /api/interview/resume      multipart file + persona → profile, questions, audio
POST /api/interview/persona     {message: persona_id} → switch persona + audio
POST /api/interview/answer      {message, delivery?} → score, feedback, next Q, audio
GET  /api/interview/state       current session snapshot
POST /api/interview/reset       clear the interview session
```

### Reference: working configuration

These are the versions this project was verified against:

| Component | Version |
|---|---|
| Python | 3.12.10 |
| torch | 2.14.1+cpu |
| kokoro / misaki | 0.9.4 |
| transformers | 5.18.0 |
| numpy | 2.2.6 |
| ffmpeg | 9.0.2 |
| Node.js / npm | 24.12.0 / 11.13.0 |

Model: `hexgrad/Kokoro-82M`, cached under `~/.cache/huggingface` after first run.