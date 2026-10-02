# Aria — Setup Guide

**Audience:** an AI agent (or human) setting this project up from a fresh clone.
Follow the steps **in order**. Every step has a **Verify** command and the exact
expected output. **If a Verify fails, stop and use Troubleshooting — do not
continue to the next step.**

Total time: ~5–10 minutes.

---

## 0. What this project is

Aria is a **voice-based interview practice coach**. You talk to it; it listens,
answers out loud, and scores your interview answers against a real HR scorecard.

| Part | Tech | Runs on | Cost |
|---|---|---|---|
| Brain (LLM) | `qwen/qwen3.8-27b` (or `openai/gpt-oss-120b`) via Groq | Groq cloud | free tier |
| Speech-to-text | `whisper-large-v3-turbo` via Groq | Groq cloud | same free key |
| Text-to-speech | **Kokoro ONNX** (`kokoro-v1.0.onnx`) | **locally** | free, offline, CPU |

**The only local model is Kokoro ONNX** (text-to-speech, ~325 MB ONNX model + 28 MB voice embeddings).
The LLM and STT are Groq cloud calls, so a **Groq API key is required** — you cannot run the LLM offline.

Architecture:

```
Chrome ──mic (MediaRecorder webm/opus)──▶ FastAPI /api/transcribe
        ──text─────────────────────────▶ FastAPI /api/chat
                                            ├─▶ Groq Qwen 27B / GPT-OSS 120B (LLM)
                                            └─▶ Kokoro ONNX local (TTS) → wav (24kHz)
Chrome ◀──<audio> playback───────────────────┘
```

---

## 1. Prerequisites

You need **all three** of these before starting:

| Tool | Version | Why |
|---|---|---|
| Python | **3.12.x recommended** | Clean wheels for ONNX runtime and audio tools |
| Node.js | 20+ (22/24 fine) | Builds the React frontend |
| ffmpeg | any recent | Decodes browser mic audio in `backend/server.py` |

### Windows

> **Use winget for ffmpeg.** Winget installs per-user and does not need administrator rights.

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
```

**Verify (all platforms):**

```bash
ffmpeg -version       # expect: ffmpeg version 6.x / 7.x / 9.x
node --version        # expect: v20.x or higher
```

---

## 2. Get a Groq API key (free, no credit card)

1. Sign up at <https://console.groq.com>.
2. Dashboard → **API Keys** → **Create Key**.
3. Copy it (starts with `gsk_`).

Paste it into `.env` (see Step 5).

---

## 3. Create the virtual environment

From the repository root:

```bash
python3.12 -m venv .venv          # Windows: py -3.12 -m venv .venv
```

Activate it:

| Shell | Command |
|---|---|
| Windows PowerShell | `.venv\Scripts\Activate.ps1` |
| Windows cmd.exe | `.venv\Scripts\activate.bat` |
| macOS / Linux bash | `source .venv/bin/activate` |

> **Windows PowerShell Execution Policy Note:** If PowerShell shows:
> *"Do you want to run software from this untrusted publisher? ... Activate.ps1"*,
> press **`A`** (Always run), or run:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Verify:**

```bash
python --version        # MUST print Python 3.12.x
```

---

## 4. Install dependencies (Kokoro ONNX)

Unlike earlier versions that required heavy PyTorch CUDA/CPU builds and suffered from `numpy 2.x` / `scipy` conflicts, Aria now uses **Kokoro ONNX**:

```bash
pip install -r requirements.txt
```

This installs `kokoro-onnx`, `onnxruntime`, `groq`, `sounddevice`, `soundfile`,
`fastapi`, `uvicorn`, `pymupdf`, `pypdf`, `pytesseract` and dependencies.

**Verify:**

```bash
python -c "import kokoro_onnx, groq, fastapi, soundfile; print('deps OK')"
```

---

## 5. Configure the environment (`.env`)

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

Open `.env` and configure your settings:

```env
GROQ_API_KEY=gsk_your_actual_key_here
GROQ_MODEL=qwen/qwen3.8-27b
```

> **Note on models:** `qwen/qwen3.8-27b` is recommended for sub-second conversational latency. If your Groq account has `openai/gpt-oss-120b`, you can set `GROQ_MODEL=openai/gpt-oss-120b`.

**Verify:**

```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('Key valid:', os.getenv('GROQ_API_KEY','').startswith('gsk_'))"
```

---

## 6. Download Kokoro ONNX model weights

The ONNX model and voice embeddings live in `models/`:
- `models/kokoro-v1.0.onnx` (~325 MB)
- `models/voices-v1.0.bin` (~28 MB)

Run this one-liner to download them if not already present:

```bash
python -c "
import urllib.request, os
os.makedirs('models', exist_ok=True)
files = [
    ('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin', 'models/voices-v1.0.bin'),
    ('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx', 'models/kokoro-v1.0.onnx')
]
for url, dest in files:
    if not os.path.exists(dest) or os.path.getsize(dest) < 1000000:
        print('Downloading', url, '->', dest)
        urllib.request.urlretrieve(url, dest)
print('Models ready!')
"
```

**Verify:**

```bash
python -c "
from backend import tts
samples, sr = tts.generate('Aria is ready. Let us practice.')
print(f'KOKORO ONNX OK: {len(samples)/sr:.2f}s of audio generated at {sr} Hz')
"
```

**Expected output:** `KOKORO ONNX OK: ~2.5s of audio generated at 24000 Hz`.

---

## 7. Build the frontend

The backend serves the React app as static files from `frontend/dist`:

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

## 8. Start the backend

### Windows (One-Click)
Double-click **`START.bat`** in the repository root.
`START.bat` automatically configures Python 3.12 DLL paths, mounts virtual environment packages, and starts uvicorn with live reload.

### Terminal (Cross-Platform)
From the project root:

```bash
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000 --reload
```

Open **<http://localhost:8000>** in your browser.

- Tap the mic and speak, or type your message.
- Choose from 5 interviewer personas with tailored Kokoro voices.
- Upload your resume (PDF/TXT) for tailored questions and rubric scoring.

---

## 9. Interviewer personalities & voices

All personas use high-fidelity, local Kokoro voices:

| Mode | Personality | Voice | Style |
|---|---|---|---|
| **The Panel** | Balanced structured interview | `af_heart` | Neutral, professional, competent |
| **The High-Bar Manager** | Demanding, evidence-obsessed | `am_michael` | Deep, challenging, analytical |
| **The Trickster** | Adversarial, tests composure | `bm_george` | Sharp, British inflection |
| **The Kind Soul** | Supportive mentor | `af_bella` | Warm, encouraging, patient |
| **The Rapid-Fire Recruiter** | Fast screening round | `am_adam` | Energetic, direct, brisk |

---

## 10. Troubleshooting

### `500 Internal Server Error` on `/api/chat`
1. Check `/api/health` in your browser (<http://localhost:8000/api/health>). It reports:
   - `ok`: `true`
   - `kokoro_onnx`: `true`
   - `model`: your active Groq model
2. If `groq.NotFoundError` occurs, the model in `GROQ_MODEL` is not available on your Groq key. Set `GROQ_MODEL=qwen/qwen3.8-27b` in `.env`.
3. Check that `models/kokoro-v1.0.onnx` and `models/voices-v1.0.bin` exist and are non-empty.

### Windows DLL Conflict (`_ssl` or `_ctypes` error)
If you have multiple Python versions installed (e.g. Python 3.14 alongside 3.12), Windows may load conflicting DLLs from PATH.
- Run the server using **`START.bat`** which sets Python 3.12 DLL directory precedence.

### Missing ffmpeg
If mic transcription returns `ffmpeg not found`:
- Run `winget install --id Gyan.FFmpeg -e` and open a fresh terminal so the updated `PATH` takes effect.