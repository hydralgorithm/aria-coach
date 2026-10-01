"""Groq API layer: LLM brain + Whisper speech-to-text (one free key)."""

from __future__ import annotations

import os

from dotenv import load_dotenv
from groq import Groq

load_dotenv()
from groq.types.chat import ChatCompletion

MODEL = "openai/gpt-oss-120b"  # llama-3.3-70b was retired from Groq
STT_MODEL = "whisper-large-v3-turbo"

client: Groq | None = None


def get_client() -> Groq:
    global client
    if client is None:
        client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
    return client


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
    """Send text to Llama on Groq; return the assistant reply."""
    _history.append({"role": "user", "content": user_text})
    completion: ChatCompletion = get_client().chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, *_history],
        temperature=0.7,
        max_tokens=512,
        reasoning_format="hidden",  # gpt-oss thinks out loud; we only want the answer
    )
    reply = completion.choices[0].message.content or ""
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
