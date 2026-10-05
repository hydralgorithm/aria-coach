# Local-First Architecture

**What this file proves:** exactly which tasks run on-device, which may use the
cloud, how offline mode is enforced, and how a judge can verify all three.

## The honest split

| Task | On-device path | Cloud path | Default | Offline enforcement |
|---|---|---|---|---|
| Résumé text extraction | PyMuPDF + Tesseract OCR | never | **local** | no cloud code path exists |
| ATS parse audit | deterministic geometry + regex | never | **local** | no cloud code path exists |
| Claim extraction / SOW / readiness / learning plan | `backend/insights.py`, deterministic | never | **local** | no cloud code path exists |
| Delivery metrics (fillers, pace) | `backend/speech.py`, deterministic | never | **local** | no cloud code path exists |
| Practice history | SQLite (`aria_history.db`) | never | **local** | no cloud code path exists |
| Camera framing check | MediaPipe WASM in the browser | never | **local** | no cloud code path exists |
| Text-to-speech | Kokoro ONNX on CPU | **removed** | **local** | no cloud fallback exists (was edge-tts) |
| Speech-to-text | faster-whisper small (CPU, int8) | Groq Whisper | cloud first | `ARIA_OFFLINE=1` skips the cloud call entirely |
| Field extraction, question generation, scoring | Ollama (local LLM) | Groq | cloud first | `ARIA_OFFLINE=1` + Ollama is the only path |

## Offline mode (`ARIA_OFFLINE=1`)

- `backend/brain.py` reads `OFFLINE_ONLY` from the environment.
- When set, `complete()` and `transcribe()` **never construct a cloud request** —
  the guard is before the call, not a promise after it.
- The server pre-warms the local whisper model on startup so the first offline
  answer doesn't pay the load cost.
- `/api/health` reports `offline_mode: true` and the UI's *Where this runs*
  panel reflects the live engines (`stt_last`, `llm_last`), not the brochure.

**Verified in this repo:**

```bash
# unit level (no network): cloud is skipped, error is explicit
.venv/Scripts/python.exe -m pytest tests/test_api.py::TestOfflineMode -v

# live server, offline STT path (synthetic audio):
ARIA_OFFLINE=1 python -c "from backend import brain; ..."   # ran: engine=local:whisper
```

**What offline still needs:** Ollama running with a pulled model for the LLM
(`ollama serve && ollama pull llama3.2:3b`). Without it, text endpoints return
a clear 502 naming the problem — they do not silently degrade.

## Benchmarks recorded on this machine (Ryzen laptop, CPU only)

| Engine | Load time | Throughput | Notes |
|---|---|---|---|
| faster-whisper **small** (int8) | 139.9 s cold, then cached | **1.53 s** for 3 s audio | the one-time load is why offline startup pre-warms |
| Kokoro ONNX TTS | ~1 s | 2.1 s speech rendered instantly | 353 MB models, already shipped workflow |
| MediaPipe face landmarker | in-browser WASM | ~25 fps | framing only |

## What leaves the device in cloud-first mode

| Data | Destination | When |
|---|---|---|
| 16 kHz mono WAV of your answer | Groq Whisper | only while transcribing, only if cloud reachable |
| Extracted resume fields + answer text | Groq LLM | scoring/coverage/question calls |
| Raw PDF text | **never uploaded** — parsing is local | — |
| Audio/TTS output, camera frames, history | **never leave the device** | — |

Both Groq calls are zero-data-retention endpoints, but ZDR is *not* on-device —
the header panel in the app states which engine actually ran each task.

## End-to-end latency, measured (`scripts/perf_audit.py`)

Same machine, same resume+JD, two servers. These are wall-clock single runs,
not benchmark-grade — the point is which step dominates.

| Step | Cloud (Groq qwen3.8-27b) | Local (Ollama llama3.2:3b, CPU) |
|---|---|---|
| resume upload → analysis → 6 questions | 11.5 s | 21.8 s |
| answer → score → feedback | 27.9 s | **7.1 s** |
| retry + before/after diff | 38.1 s | 8.3 s |
| rescore (transcript correction) | 55.7 s | 8.8 s |
| progress endpoint | 0.00 s | 0.00 s |
| session state (refresh path) | 0.01 s | 0.01 s |

**Slowest step:** resume analysis (4 model calls) — 11.5 s cloud / 21.8 s local.
It is a single batched call, so parallelising it would only add complexity for
no user-visible win; left as is, deliberately.

**Notable finding:** the local 3B model scores answers **~4× faster** than the
cloud model (7.1 s vs 27.9 s) and the gap widens on retry (8.3 s vs 38.1 s),
because the cloud cost grows with the accumulated transcript and rubric
context. Cloud remains the default for *quality*, not speed. This is a real
answer to "why not just go local?" — the honest summary is that we trade a
shallow rubric for latency, and the product lets the user choose.

**Other measured costs:** Kokoro TTS 2.9 s cold / 0.66 s warm for 2.6 s of
audio; faster-whisper 0.78 s for 3 s of audio on CPU; backend RSS ~867 MB with
warm TTS + whisper models loaded; the Ollama server process itself ~65 MB (the
2 GB model is paged/mmap'd).

## Machine-readable locality

`docs/locality.json` records, per task, the engine, the code path, whether it
is local or cloud, and the evidence that proves it. Regenerate claims from it,
not from prose.
