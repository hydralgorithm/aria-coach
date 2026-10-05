"""Groq API layer: LLM brain + Whisper speech-to-text (one free key)."""

from __future__ import annotations

import contextvars
import json
import os
import urllib.error
import urllib.request

from dotenv import load_dotenv
from groq import Groq

load_dotenv()
from groq.types.chat import ChatCompletion

# Available fast chat models on Groq: "qwen/qwen3.8-27b", "openai/gpt-oss-120b"
MODEL = os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b")
STT_MODEL = "whisper-large-v3-turbo"

# Hard ceiling on one cloud round-trip. Without this a hung connection stalls
# the request (and with a blocked event loop, the whole app) indefinitely.
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "120"))
STT_TIMEOUT = float(os.environ.get("STT_TIMEOUT", "60"))

# Local fallback, used only when the cloud is unreachable. Ollama runs entirely
# on-device, so this is the offline path - not the default, because a 3B model
# is measurably weaker at rubric judgement than the cloud model.
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")

# Offline mode: never contact the cloud, no matter what. Set ARIA_OFFLINE=1 to
# demo with the network fully disabled — every task then runs on local engines
# (Ollama for text, faster-whisper for speech, Kokoro for TTS). Read via
# property so tests can toggle it.
OFFLINE_ONLY = os.environ.get("ARIA_OFFLINE", "0") == "1"

# Which engine served the most recent completion, for diagnostics.
LAST_ENGINE = ""
# Which engine served the most recent transcription, for diagnostics.
LAST_STT_ENGINE = ""

client: Groq | None = None


def get_client() -> Groq:
    global client
    if client is None:
        client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
    return client


# ------------------------------------------------- cloud -> local completion


def ollama_available(timeout: float = 1.5) -> bool:
    """True when a local Ollama server answers. Cheap, but not free - callers
    should not poll it in a loop."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=timeout) as r:
            return getattr(r, "status", 200) == 200
    except Exception:
        return False


def _ollama_chat(
    messages: list[dict[str, str]],
    temperature: float,
    json_mode: bool,
    model: str | None = None,
) -> str:
    payload: dict = {
        "model": model or OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        # Ollama's 5-minute default unloads a CPU 3B model between requests,
        # so every other call pays a cold load and can blow the timeout.
        "keep_alive": os.environ.get("OLLAMA_KEEP_ALIVE", "30m"),
        "options": {"temperature": temperature},
    }
    if json_mode:
        payload["format"] = "json"
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read().decode("utf-8") or "{}")
    return str((data.get("message") or {}).get("content") or "")


def _is_rate_limit(exc: Exception) -> bool:
    """Groq 429s are mostly transient (a TPM window) — retry once, briefly."""
    text = str(exc).lower()
    return "429" in text or "rate limit" in text or "too large" in text


def complete(
    messages: list[dict[str, str]],
    temperature: float = 0.5,
    max_tokens: int = 1800,
    json_mode: bool = False,
) -> tuple[str, str]:
    """Return (text, engine). Groq first; fall back to local Ollama if it fails.

    The fallback exists so the product still works with no network - it is not a
    silent quality downgrade, and the active engine is reported in /api/health.
    Every cloud call carries a hard timeout so a hung connection degrades to the
    local path (or a clear error) instead of stalling the request forever.
    A 429 (per-minute token budget) is retried once after a short pause before
    the local fallback takes over — free-tier bursts are the common case.
    """
    global LAST_ENGINE
    groq_error: Exception | None = None
    if not OFFLINE_ONLY:
        for attempt in (1, 2):
            try:
                kwargs: dict = {
                    "model": MODEL,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "timeout": LLM_TIMEOUT,
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                completion: ChatCompletion = get_client().chat.completions.create(
                    **kwargs
                )
                choice = completion.choices[0]
                text = choice.message.content or ""
                if not text:
                    text = getattr(choice.message, "reasoning", "") or ""
                LAST_ENGINE = "groq"
                return text, "groq"
            except Exception as exc:  # noqa: BLE001 - any Groq failure falls back
                groq_error = exc
                if attempt == 1 and _is_rate_limit(exc):
                    import time as _time

                    print("  [llm] cloud rate-limited; pausing 4s and retrying once")
                    _time.sleep(4)
                    continue
                break
        print(f"  [llm] cloud failed ({type(groq_error).__name__}); trying local Ollama")

    # Local engine is tried in both modes: it is the *only* engine in offline
    # mode. (This check must come after the attempt, not before, or offline
    # mode would refuse to use the very model it was built for.)
    if not ollama_available():
        if OFFLINE_ONLY:
            raise RuntimeError(
                "offline mode is on and no local Ollama answered: start Ollama "
                "(`ollama serve`) or set ARIA_OFFLINE=0"
            )
        raise RuntimeError(
            f"cloud LLM failed and no local Ollama is running: {groq_error}"
        )
    try:
        text = _ollama_chat(messages, temperature, json_mode)
    except Exception as exc:  # noqa: BLE001
        if OFFLINE_ONLY:
            raise RuntimeError(
                f"offline mode is on and the local model failed: {exc}"
            ) from exc
        raise RuntimeError(
            f"cloud LLM failed ({groq_error}); local Ollama fallback failed ({exc})"
        ) from exc
    LAST_ENGINE = "ollama"
    return text, "ollama"


# ---------------------------------------------------------------- LLM brain

SYSTEM_PROMPT = (
    "You are Aria, a warm, witty voice coach for interview practice. "
    "Keep replies short (1-3 spoken sentences), conversational, and natural "
    "to say out loud. Ask a follow-up question most of the time. Never use "
    "markdown, bullet points, or emoji in replies."
)

# Free-chat history is scoped per client session (the same X-Session-Id that
# scopes interview state), so two tabs never bleed conversation into each other.
_histories: dict[str, list[dict[str, str]]] = {}
_history_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "aria_chat_history", default="default"
)


def bind_chat_session(sid: str) -> contextvars.Token:
    return _history_var.set(sid)


def _history() -> list[dict[str, str]]:
    sid = _history_var.get()
    if sid not in _histories:
        _histories[sid] = []
        # keep memory bounded: drop the oldest conversations
        if len(_histories) > 32:
            oldest = next(iter(_histories))
            _histories.pop(oldest, None)
    return _histories[sid]


def reset_history() -> None:
    _history().clear()


def chat(user_text: str) -> str:
    """Send text to the LLM (cloud first, local fallback); return the reply."""
    history = _history()
    history.append({"role": "user", "content": user_text})
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history]
    reply, _engine = complete(messages, temperature=0.7, max_tokens=512)
    history.append({"role": "assistant", "content": reply})
    return reply


# ------------------------------------------------------- speech-to-text
#
# Cloud path: Groq Whisper (most accurate on accents, needs network).
# Local path: faster-whisper small (int8, CPU, ~460 MB download on first use,
# cached in models/). The local path exists so the core product genuinely runs
# offline — a judge can unplug the network and speaking practice still works.

_whisper_model = None


def _get_whisper():
    """Load the local faster-whisper model once (CPU, int8)."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        _whisper_model = WhisperModel(
            os.environ.get("LOCAL_STT_MODEL", "small"),
            device="cpu",
            compute_type="int8",
        )
    return _whisper_model


def transcribe_local(wav_bytes: bytes) -> str:
    """Transcribe 16 kHz mono WAV bytes entirely on-device."""
    import io

    import numpy as np
    import soundfile as sf

    audio, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if sr != 16000:
        # ffmpeg output is already 16 kHz; resample defensively anyway
        import math

        n_out = math.ceil(len(audio) * 16000 / sr)
        idx = np.minimum(
            (np.arange(n_out) * sr / 16000).astype(int), len(audio) - 1
        )
        audio = audio[idx]
    model = _get_whisper()
    segments, _info = model.transcribe(
        audio, language="en", beam_size=1, vad_filter=True
    )
    return " ".join(s.text.strip() for s in segments if s.text.strip()).strip()


def transcribe(wav_bytes: bytes) -> str:
    """Transcribe 16 kHz mono WAV bytes.

    Cloud (Groq Whisper) first for accuracy; falls back to the on-device
    faster-whisper model when the network is down, ARIA_OFFLINE=1 is set, or
    there is no API key. The caller surfaces which engine ran via /api/health.
    """
    global LAST_STT_ENGINE
    if not OFFLINE_ONLY:
        try:
            result = get_client().audio.transcriptions.create(
                file=("speech.wav", wav_bytes, "audio/wav"),
                model=STT_MODEL,
                language="en",
                response_format="text",
                timeout=STT_TIMEOUT,
            )
            LAST_STT_ENGINE = "groq"
            return (result or "").strip()
        except Exception as exc:  # noqa: BLE001 - fall back to on-device STT
            print(
                f"  [stt] cloud transcription failed ({type(exc).__name__}); "
                "trying local whisper"
            )
    text = transcribe_local(wav_bytes)
    LAST_STT_ENGINE = "local:whisper"
    if not text:
        raise RuntimeError("local transcription returned nothing for that audio")
    return text
