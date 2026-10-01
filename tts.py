"""Kokoro-82M text-to-speech (local, on-device)."""

from __future__ import annotations

import re
import time

import numpy as np
from kokoro import KPipeline

# 'af_heart' is the most natural female voice; there are ~9 others:
# af_bella, af_nicole, am_adam, am_michael, bf_emma, bm_george, ...
VOICE = "af_heart"

_pipeline: KPipeline | None = None


def get_pipeline() -> KPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")  # 'a' = American English; downloads on 1st run
    return _pipeline


def _clean(text: str) -> str:
    """Strip filler the TTS engine reads out loud or chokes on."""
    text = re.sub(r"[*_#`]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def speak(text: str) -> None:
    """Speak text out loud through the default output device."""
    text = _clean(text)
    if not text:
        return
    started = time.time()
    first = True
    for result in get_pipeline()(text, voice=VOICE):
        audio = getattr(result, "audio", None)
        if audio is None:
            continue
        if hasattr(audio, "detach"):  # torch tensor -> numpy
            audio = audio.detach().cpu().float().numpy()
        if first:
            print(f"  [tts] spoke in {time.time() - started:.1f}s")
            first = False
        _play(np.asarray(audio, dtype=np.float32))


def _play(audio: np.ndarray) -> None:
    import sounddevice as sd

    sd.play(audio, samplerate=24000)
    sd.wait()  # block until finished (keeps convo order)


if __name__ == "__main__":
    speak("Hey! I'm Aria, your voice coach. Let's get you interview ready!")
