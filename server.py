"""Aria backend: FastAPI wrapper around the Groq + Kokoro pipeline."""

from __future__ import annotations

import io
import time
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import brain
import coach

app = FastAPI(title="Aria backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIO_DIR = Path("static/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# webm/opus (MediaRecorder default) -> 16 kHz mono WAV for Whisper
_TARGET_SR = 16000


def _to_wav_bytes(raw: bytes, mime: str) -> bytes:
    """Decode browser audio (webm/opus etc.) to 16 kHz mono WAV via ffmpeg."""
    import subprocess

    ext = "webm" if "webm" in mime else "mp4" if "mp4" in mime else "dat"
    src = AUDIO_DIR / f"tmp_{uuid.uuid4().hex}.{ext}"
    src.write_bytes(raw)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(src),
                "-ac",
                "1",
                "-ar",
                str(_TARGET_SR),
                str(src.with_suffix(".wav")),
            ],
            check=True,
        )
        return src.with_suffix(".wav").read_bytes()
    finally:
        src.unlink(missing_ok=True)
        src.with_suffix(".wav").unlink(missing_ok=True)


class ChatRequest(BaseModel):
    message: str
    # optional delivery metrics from the local webcam analysis
    delivery: dict | None = None


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        raise HTTPException(400, "empty audio body")
    mime = request.headers.get("content-type", "audio/webm")
    started = time.time()
    wav = _to_wav_bytes(raw, mime)
    try:
        text = brain.transcribe(wav)
    except Exception as exc:
        raise HTTPException(502, f"transcription failed: {exc}") from exc
    print(f"  [stt] {time.time() - started:.1f}s -> {text[:60]!r}")
    return {"text": text}


def synthesize_audio(text: str, voice: str | None = None) -> str:
    """Render text with Kokoro (local) and return the served audio URL."""
    import tts as tts_mod

    def render(v: str) -> list:
        out: list = []
        for result in tts_mod.get_pipeline()(tts_mod._clean(text), voice=v):
            audio = getattr(result, "audio", None)
            if audio is None:
                continue
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().float().numpy()
            out.append(audio)
        return out

    try:
        segments = render(voice or tts_mod.VOICE)
    except Exception as exc:  # a persona voice pack may be unavailable
        print(f"  [tts] voice '{voice}' failed ({exc}) — falling back")
        segments = render(tts_mod.VOICE)

    filename = f"{uuid.uuid4().hex}.wav"
    if segments:
        merged = np.concatenate(segments) if len(segments) > 1 else segments[0]
        sf.write(AUDIO_DIR / filename, merged, 24000)
    else:
        sf.write(AUDIO_DIR / filename, np.zeros(1, dtype="float32"), 24000)
    return f"/static/audio/{filename}"


@app.post("/api/chat")
async def chat(req: ChatRequest) -> dict:
    started = time.time()
    try:
        reply = brain.chat(req.message)
    except Exception as exc:
        raise HTTPException(502, f"LLM failed: {exc}") from exc

    audio_url = synthesize_audio(reply)
    print(f"  [turn] {time.time() - started:.1f}s total")
    return {"reply": reply, "audio_url": audio_url}


@app.post("/api/reset")
async def reset() -> dict:
    brain.reset_history()
    return {"ok": True}


# ------------------------------------------------------------- interview coach

@app.get("/api/personas")
async def personas() -> dict:
    return {"personas": coach.list_personas(), "active": coach._state["persona"]}


@app.post("/api/interview/resume")
async def interview_resume(
    file: UploadFile = File(...), persona: str = Form("standard")
) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    started = time.time()
    try:
        result = coach.load_resume(
            file.filename or "resume.pdf", data, persona_id=persona
        )
    except Exception as exc:
        raise HTTPException(400, f"could not process resume: {exc}") from exc

    first = coach.current_question()
    intro = (
        f"I've read your resume. Here's your first question: {first['question']}"
        if first
        else "Resume loaded."
    )
    print(
        f"  [interview] resume parsed via {result['parse'].get('method')} "
        f"in {time.time() - started:.1f}s ({persona})"
    )
    return {
        **result,
        "persona_info": coach.persona_public(coach._state["persona"]),
        "current_question": first,
        "audio_url": synthesize_audio(intro, voice=coach.persona_voice()),
    }


@app.post("/api/interview/persona")
async def interview_persona(req: ChatRequest) -> dict:
    try:
        coach.set_persona(req.message)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    info = coach.persona_public(coach._state["persona"])
    greeting = f"Switching mode. I'm now {info['label']}. {info['tagline']}."
    return {
        "persona": info,
        "audio_url": synthesize_audio(greeting, voice=coach.persona_voice()),
    }


@app.post("/api/interview/answer")
async def interview_answer(req: ChatRequest) -> dict:
    started = time.time()
    try:
        result = coach.score_answer(req.message, delivery=req.delivery)
    except Exception as exc:
        raise HTTPException(502, f"scoring failed: {exc}") from exc
    spoken = result.get("spoken_feedback") or result.get("verdict") or ""
    print(
        f"  [interview] answer scored in {time.time() - started:.1f}s "
        f"({result['score']}/100, {coach._state['persona']})"
    )
    return {
        **result,
        "audio_url": synthesize_audio(spoken, voice=coach.persona_voice()),
    }


@app.get("/api/interview/state")
async def interview_state() -> dict:
    return {**coach.state(), "current_question": coach.current_question()}


@app.post("/api/interview/reset")
async def interview_reset() -> dict:
    coach.reset()
    return {"ok": True}


# serve generated audio BEFORE the SPA catch-all mount
app.mount("/static", StaticFiles(directory="static"), name="static")
# serve frontend build last (catch-all)
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="spa")
