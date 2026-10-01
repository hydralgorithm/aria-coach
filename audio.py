"""Microphone capture -> mono 16 kHz WAV bytes (ready for Whisper).

Latency-focused: the stream stops the instant a pause is detected (no fixed
sleep), the threshold auto-calibrates to room noise each turn, and leading
silence is trimmed before upload so transcription stays fast.
"""

from __future__ import annotations

import io
import threading
import wave

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000  # Whisper's expected sample rate
CHANNELS = 1
BLOCKSIZE = 1024  # 64 ms per block

MIN_THRESHOLD = 0.008  # floor so a dead-quiet room doesn't trigger on breath
AMBIENT_MULTIPLIER = 3.0  # speech must be 3x louder than measured room noise
CALIBRATION_SECONDS = 0.8
LEAD_IN_SECONDS = 0.3  # keep a little audio before the first loud block


def _pick_input_device() -> int | None:
    """Return an input-capable device index, or None if no mic exists."""
    try:
        default = sd.default.device[0]
        if default is not None and int(default) != -1:
            return int(default)
    except Exception:
        pass

    try:
        devices = sd.query_devices()
    except Exception:
        return None

    for idx, dev in enumerate(devices):
        try:
            if int(dev.get("max_input_channels", 0)) > 0:
                return idx
        except Exception:
            continue
    return None


def _rms(block: np.ndarray) -> float:
    return float(np.sqrt(np.mean(block.astype(np.float32) ** 2)))


def _measure_ambient(device: int) -> float:
    """Estimate room noise RMS so the speech threshold adapts each turn."""
    levels: list[float] = []

    def cb(indata, frames, time_info, status) -> None:  # noqa: ANN001
        levels.append(_rms(indata[:, 0]))

    with sd.InputStream(
        device=device,
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        blocksize=BLOCKSIZE,
        callback=cb,
    ):
        sd.sleep(int(CALIBRATION_SECONDS * 1000))  # fixed short window, fine

    ambient = float(np.mean(levels)) if levels else 0.0
    return max(MIN_THRESHOLD, ambient * AMBIENT_MULTIPLIER)


def record_until_silence(
    max_seconds: float = 15.0,
    silence_seconds: float = 0.9,
    threshold: float | None = None,  # None = auto-calibrate from room noise
) -> bytes | None:
    """Record until `silence_seconds` of quiet after speech, then return fast.

    Returns trimmed 16-bit mono WAV bytes, or None if no mic / nothing heard.
    """
    device = _pick_input_device()
    if device is None:
        print("  [audio] No microphone found.")
        return None

    if threshold is None:
        threshold = _measure_ambient(device)

    chunks: list[np.ndarray] = []
    stop_event = threading.Event()
    state = {"spoken": False, "silent_run": 0.0}

    def callback(indata, frames, time_info, status) -> None:  # noqa: ANN001
        if stop_event.is_set():
            raise sd.CallbackStop
        if status:
            print(f"  [audio] {status}")
        chunks.append(indata[:, 0].copy())
        level = _rms(indata[:, 0])
        if level > threshold:
            state["spoken"] = True
            state["silent_run"] = 0.0
        elif state["spoken"]:
            state["silent_run"] += frames / SAMPLE_RATE
            if state["silent_run"] >= silence_seconds:
                stop_event.set()  # wakes the waiter immediately
                raise sd.CallbackStop

    print("  [mic] Listening... (pause ~1s when done)")
    with sd.InputStream(
        device=device,
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        blocksize=BLOCKSIZE,
        callback=callback,
    ):
        # Returns the moment the callback sets the event -> no dead wait.
        if not stop_event.wait(timeout=max_seconds) and not state["spoken"]:
            print("  [audio] Nothing captured (too quiet or mic blocked).")
            return None

    trimmed = _trim(chunks, threshold)
    if not trimmed:
        print("  [audio] Only noise captured, ignoring.")
        return None
    return _pack_wav(trimmed)


def _trim(chunks: list[np.ndarray], threshold: float) -> list[np.ndarray]:
    """Drop leading silence, keeping LEAD_IN_SECONDS before speech starts."""
    keep_from = int(LEAD_IN_SECONDS * SAMPLE_RATE / BLOCKSIZE)
    for i, chunk in enumerate(chunks):
        if _rms(chunk) > threshold:
            start = max(0, i - keep_from)
            return chunks[start:]
    return []


def _pack_wav(chunks: list[np.ndarray]) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        for chunk in chunks:
            wf.writeframes(chunk.tobytes())
    return buf.getvalue()
