# Aria — Setup Guide

**Audience:** a human or an AI agent setting this project up from a fresh clone.

Follow the steps **in order**. Every step has a **Verify** command and the expected
output. **If a Verify fails, stop and use Troubleshooting — do not continue.**

Time: ~5–10 minutes on a normal connection (plus ~353 MB of model download).
Disk: ~2 GB (mostly the Kokoro model + Python/Node caches).

---

## 0. What this project is

Aria is a **voice-first interview practice coach**. You talk to it; it shows you the
transcript it heard, scores your answers on a real HR scorecard, cites the exact words
behind every observation, and publishes how unreliable its own score is.

| Part | Tech | Runs on | Cost |
|---|---|---|---|
| Brain (LLM) | `qwen/qwen3.8-27b` via Groq, local Ollama fallback | cloud (fallback local) | free tier |
| Speech-to-text | `whisper-large-v3-turbo` via Groq | cloud | same free key |
| Text-to-speech | Kokoro ONNX | **locally** | free, offline, CPU |
| Camera check | MediaPipe Face Landmarker | **in-browser** | free, offline |

**Required:** a Groq API key (LLM + STT).
**Manual download:** the two Kokoro files (~353 MB). Everything else — including the
camera model — ships with the repository.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Python | **3.12.x** (required) | clean wheels for ONNX Runtime and audio tooling |
| Node.js | 20+ (22/24 fine) | builds the React frontend |
| ffmpeg | any recent | decodes browser mic audio in `backend/server.py` |

### Install ffmpeg

```bash
# Windows (per-user, no admin needed)
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements

# macOS
brew install ffmpeg

# Debian / Ubuntu
sudo apt update && sudo apt install -y ffmpeg python3.12 python3.12-venv build-essential
```

### (Optional) Tesseract — only needed for scanned/image-only résumé PDFs

```bash
winget install --id UB-Mannheim.TesseractOCR -e     # Windows
brew install tesseract                              # macOS
sudo apt install -y tesseract-ocr                   # Debian / Ubuntu
```

### (Optional) Ollama — offline fallback and the independent validation judge

```bash
# install from https://ollama.com, then:
ollama pull llama3.2:3b
```

**Verify (all platforms):**

```bash
ffmpeg -version      # any recent version
node --version       # v20.x or higher
```

---

## 2. Get a Groq API key (free, no credit card)

1. Sign up at <https://console.groq.com>.
2. **API Keys → Create Key**.
3. Copy it (starts with `gsk_`).

You will paste it into `.env` in step 5.

---

## 3. Create the virtual environment (Python 3.12)

```bash
# macOS / Linux
python3.12 -m venv .venv

# Windows
py -3.12 -m venv .venv
```

Activate it:

| Shell | Command |
|---|---|
| Windows PowerShell | `.venv\Scripts\Activate.ps1` |
| Windows cmd.exe | `.venv\Scripts\activate.bat` |
| macOS / Linux bash | `source .venv/bin/activate` |

> **PowerShell** may block activation. Press **`A`** (Always run), or run
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`.

**Verify:**

```bash
python --version        # MUST print Python 3.12.x
```

> **Use this interpreter for every later step.** If you have several Pythons
> installed, calling the venv binary directly avoids picking up the wrong one:
> `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (macOS/Linux).

---

## 4. Install backend dependencies

```bash
pip install -r requirements.txt
```

That covers Groq, python-dotenv, Kokoro ONNX + ONNX Runtime, sounddevice/soundfile,
NumPy, FastAPI/Uvicorn/python-multipart/pydantic, PyMuPDF, Pillow and pytesseract.
There is deliberately no SciPy/pandas/sklearn — the validation statistics are plain
NumPy (see `backend/stats.py`).

**Verify:**

```bash
python -c "import kokoro_onnx, groq, fastapi, soundfile, numpy, pymupdf, PIL, pytesseract; print('deps OK')"
```

---

## 5. Configure `.env`

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

```env
GROQ_API_KEY=gsk_your_actual_key_here
# Optional overrides
# GROQ_MODEL=qwen/qwen3.8-27b
# OLLAMA_HOST=http://127.0.0.1:11434
# OLLAMA_MODEL=llama3.2:3b
```

If your Groq account doesn't offer `qwen/qwen3.8-27b`, set `GROQ_MODEL` to a chat model
it does offer (see <https://console.groq.com/docs/models>).

**Verify:**

```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('key present:', os.getenv('GROQ_API_KEY','').startswith('gsk_'))"
```

---

## 6. Download the Kokoro TTS weights (the only manual download)

`models/` is gitignored, so these two files must be fetched once:

- `models/kokoro-v1.0.onnx` (~325 MB)
- `models/voices-v1.0.bin` (~28 MB)

```bash
python - <<'EOF'
import urllib.request, os
os.makedirs('models', exist_ok=True)
files = [
    ('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx', 'models/kokoro-v1.0.onnx'),
    ('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',   'models/voices-v1.0.bin'),
]
for url, dest in files:
    if not os.path.exists(dest) or os.path.getsize(dest) < 1_000_000:
        print('Downloading', url, '->', dest)
        urllib.request.urlretrieve(url, dest)
print('Models ready!')
EOF
```

**Verify:**

```bash
python -c "
from backend import tts
samples, sr = tts.generate('Aria is ready. Let us practice.')
print(f'Kokoro OK: {len(samples)/sr:.2f}s of audio at {sr} Hz')
"
```

**Expected:** `Kokoro OK: ~2s of audio at 24000 Hz` (exact length varies with the sentence).

> **Nothing to download for the camera check.** `frontend/public/models/face_landmarker.task`
> and the MediaPipe WASM runtime are committed to the repository.

---

## 7. Build the frontend

The backend serves the built React app from `frontend/dist`:

```bash
cd frontend
npm install
npm run build
cd ..
```

**Verify:**

```bash
ls frontend/dist/index.html         # must exist
ls frontend/public/models/face_landmarker.task   # shipped with the repo
```

---

## 8. Start the backend

**Windows:** double-click **`START.bat`** (it pins the Python 3.12 DLL paths and starts
Uvicorn with reload).

**Any platform:**

```bash
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000 --reload
```

Open **<http://127.0.0.1:8000>**.

**Verify** (works on every platform, no `curl` needed):

```bash
python -c "import urllib.request, json; print(json.dumps(json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/health')), indent=2)[:400])"
```

**Expected:** `"ok": true`, a `kokoro_onnx: true`, and an `engines` block naming the
primary LLM, the local fallback, the STT model, and whether TTS/vision are local.

---

## 9. Optional: publish the validation numbers

The repo already ships a published report at `docs/eval/error-bars.json`, shown in the
header's **Published validation** panel. To regenerate it from your own models:

```bash
python scripts/errorbars.py status              # what data exists
python scripts/errorbars.py score --repeats 3   # Aria scores the 24-answer benchmark 3x
python scripts/errorbars.py judge               # independent local model scores it (needs Ollama)
python scripts/errorbars.py analyze             # writes docs/eval/error-bars.json
```

`score` is resumable — re-running it skips answers it has already scored, so it is safe
to invoke repeatedly. No human rating is involved at any point.

---

## 10. Verify the whole project

```bash
cd frontend
npm run build                        # must succeed
npm run lint                         # baseline: 537 warnings / 3 errors, all vendored public/wasm
node scripts/face-metrics-test.mjs   # 14 checks, must print "All delivery-metric checks passed."
cd ..

python -c "from backend import coach, server, store, stats, features, errorbars; print('imports OK')"
python scripts/errorbars.py analyze  # rebuilds the report from whatever data exists
```

---

## 11. Feature tour (what to try first)

1. **Interview coach → upload a résumé** → the ATS parse audit panel shows what the
   parser actually read, plus flags for two-column layouts, tables, missing sections.
2. **Paste a JD** → the Requirement × Evidence × Confidence map builds, and the questions
   are generated from the gaps.
3. **Answer out loud** → the transcript gate appears. Edit a misheard word, confirm, and
   watch the score reflect your corrected words.
4. **Retry** any answered question → side-by-side diff with the numbers you added.
5. **Your progress** (history icon) → behaviour stats and per-competency trends, stored
   only on this device.
6. **Published validation** (flask icon) → the error bars.
7. **Where this runs** (info icon) → the honest local/cloud split.

Interviewer personas (Kokoro voices, local):

| Persona | Style | Voice |
|---|---|---|
| **The Structured Panel** | balanced competency-based | `af_heart` |
| **The Bar-Raiser** | high-bar, evidence-obsessed | `am_michael` |
| **The Talent Coach** | supportive coaching round | `af_bella` |
| **The Phone Screener** | fast first-round screen | `am_adam` |
| **The Stress Interviewer** *(advanced)* | adversarial, tests composure | `bm_george` |

---

## 12. Troubleshooting

**`/api/chat` returns 500, or `groq.NotFoundError`**
The model in `GROQ_MODEL` isn't available on your key. Set a model your account can
reach (see step 5), restart, and re-check `/api/health`.

**Windows DLL conflict (`_ssl` / `_ctypes` errors)**
Multiple Python installs (e.g. 3.14 alongside 3.12) can load conflicting DLLs. Run via
**`START.bat`**, or always use the venv interpreter directly.

**`ffmpeg` not found**
Install it (step 1) **and open a new terminal** — terminals that were already open keep
the old `PATH`. If it is installed but still not found, set `FFMPEG_BINARY` to the full
path of `ffmpeg.exe`.

**"camera permission denied" / camera unavailable**
Grant camera permission and confirm the browser can open the selected device. The camera
check is optional; scoring works without it.

**Published validation panel is empty**
No report on disk yet, or the report was built with no data. Run
`python scripts/errorbars.py analyze` (step 9). If it prints `ready=False`, you need
`score` runs first.

**Local fallback says "no local Ollama is running"**
Start Ollama and `ollama pull llama3.2:3b`, or ignore it — the cloud path is the default.

**Scanned PDF returns "could not read enough text"**
Install the Tesseract **binary** (step 1); the `pytesseract` Python package alone is not
enough.

**`npm run build` fails with "Cannot find name 'X'"**
A component import was lost in an edit. Every component used in `App.tsx` needs an
import at the top (e.g. `CameraSetup`, `ProgressPanel`, `ValidationPanel`,
`WhereItRuns`).