"""Kokoro-82M ONNX text-to-speech (local, on-device, high performance)."""

from __future__ import annotations

import os
import re
from pathlib import Path
import numpy as np

# 'af_heart' is the most natural female voice.
# Other voices: af_bella, af_nicole, af_sarah, am_adam, am_michael, bf_emma, bm_george, etc.
VOICE = "af_heart"
SPEED = 1.1

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = _PROJECT_ROOT / "models" / "kokoro-v1.0.onnx"
VOICES_PATH = _PROJECT_ROOT / "models" / "voices-v1.0.bin"

_kokoro_instance = None


def get_kokoro():
    """Lazily load and return the Kokoro ONNX model instance."""
    global _kokoro_instance
    if _kokoro_instance is None:
        from kokoro_onnx import Kokoro

        if not MODEL_PATH.exists() or not VOICES_PATH.exists():
            raise FileNotFoundError(
                f"Kokoro ONNX models not found in {MODEL_PATH.parent}. "
                f"Ensure kokoro-v1.0.onnx and voices-v1.0.bin exist."
            )
        _kokoro_instance = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
    return _kokoro_instance


def _clean(text: str) -> str:
    """Strip markdown symbols and normalize whitespace for clear spoken delivery."""
    text = re.sub(r"[*_#`~]+", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def generate(
    text: str, voice: str | None = None, speed: float | None = None
) -> tuple[np.ndarray, int]:
    """Generate audio waveform from text using Kokoro ONNX.

    Returns:
        (samples, sample_rate) where samples is a 1D float32 numpy array.
    """
    clean_text = _clean(text)
    if not clean_text:
        return np.zeros(0, dtype=np.float32), 24000

    kokoro = get_kokoro()
    v = voice or VOICE
    sp = speed or SPEED

    # Ensure voice is valid, fallback to VOICE if unrecognized
    valid_voices = kokoro.get_voices()
    if v not in valid_voices:
        v = VOICE

    samples, sample_rate = kokoro.create(
        clean_text,
        voice=v,
        speed=sp,
        lang="en-us",
    )
    return samples, sample_rate


def speak(text: str, voice: str | None = None) -> None:
    """Speak text out loud through the default system audio output."""
    clean_text = _clean(text)
    if not clean_text:
        return

    import sounddevice as sd

    samples, sample_rate = generate(clean_text, voice=voice)
    if len(samples) > 0:
        sd.play(samples, samplerate=sample_rate)
        sd.wait()
        print("  [tts] spoke via Kokoro ONNX")


if __name__ == "__main__":
    speak("Hey! I'm Aria, your voice coach. Let's get you interview ready!")
