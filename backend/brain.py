"""Groq API layer: LLM brain + Whisper speech-to-text (one free key)."""

from __future__ import annotations

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

# Local fallback, used only when the cloud is unreachable. Ollama runs entirely
# on-device, so this is the offline path - not the default, because a 3B model
# is measurably weaker at rubric judgement than the cloud model.
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")

# Which engine served the most recent completion, for diagnostics.
LAST_ENGINE = ""

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


def complete(
    messages: list[dict[str, str]],
    temperature: float = 0.5,
    max_tokens: int = 1800,
    json_mode: bool = False,
) -> tuple[str, str]:
    """Return (text, engine). Groq first; fall back to local Ollama if it fails.

    The fallback exists so the product still works with no network - it is not a
    silent quality downgrade, and the active engine is reported in /api/health.
    """
    global LAST_ENGINE
    groq_error: Exception | None = None
    try:
        kwargs: dict = {
            "model": MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        completion: ChatCompletion = get_client().chat.completions.create(**kwargs)
        choice = completion.choices[0]
        text = choice.message.content or ""
        if not text:
            text = getattr(choice.message, "reasoning", "") or ""
        LAST_ENGINE = "groq"
        return text, "groq"
    except Exception as exc:  # noqa: BLE001 - any Groq failure falls back
        groq_error = exc
        print(f"  [llm] cloud failed ({exc}); trying local Ollama")

    if not ollama_available():
        raise RuntimeError(f"cloud LLM failed and no local Ollama is running: {groq_error}")
    try:
        text = _ollama_chat(messages, temperature, json_mode)
    except Exception as exc:  # noqa: BLE001
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

_history: list[dict[str, str]] = []


def reset_history() -> None:
    _history.clear()


def chat(user_text: str) -> str:
    """Send text to the LLM (cloud first, local fallback); return the reply."""
    _history.append({"role": "user", "content": user_text})
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *_history]
    reply, _engine = complete(messages, temperature=0.7, max_tokens=512)
    _history.append({"role": "assistant", "content": reply})
    return reply


# ------------------------------------------------------- Whisper STT (Groq)

def transcribe(wav_bytes: bytes) -> str:
    """Transcribe 16 kHz mono WAV bytes via Groq's Whisper endpoint."""
    result = get_client().audio.transcriptions.create(
        file=("speech.wav", wav_bytes, "audio/wav"),
        model=STT_MODEL,
        language="en",
        response_format="text",
    )
    return (result or "").strip()
