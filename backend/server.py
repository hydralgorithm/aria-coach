"""Aria backend: FastAPI wrapper around the Groq + Kokoro pipeline."""

from __future__ import annotations

import glob
import io
import os
import shutil
import time
import tempfile
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import brain, coach, errorbars, store, tts

app = FastAPI(title="Aria backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Determine the project root (where static/ and frontend/ live)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = _PROJECT_ROOT / "static" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# webm/opus (MediaRecorder default) -> 16 kHz mono WAV for Whisper
_TARGET_SR = 16000


def _ffmpeg() -> str:
    """Locate the ffmpeg binary, with an actionable error if it is missing.

    A missing ffmpeg used to surface as a bare WinError 2 from subprocess,
    which the UI reported as "is the backend running?" even though the
    backend was healthy.

    PATH is consulted first, then FFMPEG_BINARY, then the usual Windows
    install locations. The fallback matters because terminals inherit PATH
    from their parent: an IDE or terminal tab that was already open when
    ffmpeg was installed keeps the old value, so the server can start,
    answer /api/chat, and still be unable to decode microphone audio.
    """
    candidates = [shutil.which("ffmpeg"), os.environ.get("FFMPEG_BINARY")]

    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA", "")
        program_files = [
            os.environ.get("ProgramFiles", r"C:\Program Files"),
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ]
        patterns = [
            rf"{local}\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\*\bin\ffmpeg.exe",
            rf"{local}\Microsoft\WinGet\Links\ffmpeg.exe",
            r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
            *[rf"{p}\ffmpeg\bin\ffmpeg.exe" for p in program_files],
            *[rf"{p}\ffmpeg\ffmpeg.exe" for p in program_files],
        ]
        for pattern in patterns:
            candidates.extend(sorted(glob.glob(pattern), reverse=True))

    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate

    raise RuntimeError(
        "ffmpeg was not found, so browser microphone audio cannot be decoded "
        "(typing still works). Install it with `winget install --id "
        "Gyan.FFmpeg -e` (macOS: `brew install ffmpeg`, Debian: `sudo apt "
        "install ffmpeg`). If it is already installed, this terminal has a "
        "stale PATH - either start the server from a brand-new terminal "
        "window, or set FFMPEG_BINARY to the full path of ffmpeg.exe."
    )


def _to_wav_bytes(raw: bytes, mime: str) -> bytes:
    """Decode browser audio (webm/opus etc.) to 16 kHz mono WAV via ffmpeg."""
    import subprocess

    ffmpeg = _ffmpeg()
    ext = "webm" if "webm" in mime else "mp4" if "mp4" in mime else "dat"
    src = AUDIO_DIR / f"tmp_{uuid.uuid4().hex}.{ext}"
    src.write_bytes(raw)
    try:
        try:
            subprocess.run(
                [
                    ffmpeg,
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
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or b"").decode("utf-8", "replace").strip()
            raise RuntimeError(
                f"ffmpeg could not decode the recording ({detail or exc})."
            ) from exc
        return src.with_suffix(".wav").read_bytes()
    finally:
        src.unlink(missing_ok=True)
        src.with_suffix(".wav").unlink(missing_ok=True)


class ChatRequest(BaseModel):
    message: str
    # optional camera-setup metrics from the local face tracker (never scored)
    setup: dict | None = None
    # the candidate corrected the transcript at the gate (behaviour, not a face)
    edited: bool = False
    # set when re-answering a specific question (retry / spaced practice)
    question_id: int | None = None


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        raise HTTPException(400, "empty audio body")
    mime = request.headers.get("content-type", "audio/webm")
    started = time.time()
    try:
        wav = _to_wav_bytes(raw, mime)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
    try:
        text = brain.transcribe(wav)
    except Exception as exc:
        raise HTTPException(502, f"transcription failed: {exc}") from exc
    print(f"  [stt] {time.time() - started:.1f}s -> {text[:60]!r}")
    return {"text": text}


async def synthesize_audio(text: str, voice: str | None = None) -> str:
    """Render text with Kokoro ONNX (local, high performance) and return the served audio URL."""
    clean_text = tts._clean(text)
    if not clean_text:
        clean_text = text

    filename = f"{uuid.uuid4().hex}.wav"
    dest = AUDIO_DIR / filename

    # Primary: local Kokoro ONNX
    try:
        samples, sr = tts.generate(clean_text, voice=voice)
        if len(samples) > 0:
            sf.write(str(dest), samples, sr)
            return f"/static/audio/{filename}"
    except Exception as exc:
        print(f"  [tts] Kokoro ONNX failed ({exc}) — attempting fallback")

    # Secondary fallback: edge-tts if available
    try:
        import edge_tts

        mp3_name = f"{uuid.uuid4().hex}.mp3"
        mp3_dest = AUDIO_DIR / mp3_name
        communicate = edge_tts.Communicate(clean_text, "en-US-AvaNeural", rate="+18%")
        await communicate.save(str(mp3_dest))
        if mp3_dest.exists() and mp3_dest.stat().st_size > 0:
            return f"/static/audio/{mp3_name}"
    except Exception as exc:
        print(f"  [tts] edge-tts fallback failed: {exc}")

    # Last resort: write short silent WAV so frontend audio element doesn't fail
    try:
        sf.write(str(dest), np.zeros(4000, dtype="float32"), 24000)
        return f"/static/audio/{filename}"
    except Exception as exc:
        print(f"  [tts] silent fallback failed: {exc}")
        return f"/static/audio/{filename}"


@app.get("/api/health")
async def health() -> dict:
    """Liveness probe — returns OK plus diagnostics."""
    import sys
    kokoro_ok = False
    try:
        import kokoro_onnx  # noqa: F401
        kokoro_ok = tts.MODEL_PATH.exists() and tts.VOICES_PATH.exists()
    except ImportError:
        pass
    sf_ok = False
    try:
        import soundfile  # noqa: F401
        sf_ok = True
    except ImportError:
        pass
    ollama_ok = brain.ollama_available()
    return {
        "ok": True,
        "python": sys.version,
        "executable": sys.executable,
        "kokoro_onnx": kokoro_ok,
        "soundfile": sf_ok,
        "model": brain.MODEL,
        "tts_voice": tts.VOICE,
        # Honest account of where each task runs. Cloud by default where the
        # cloud is measurably better; local where local is just as good.
        "engines": {
            "llm_primary": f"groq:{brain.MODEL}",
            "llm_fallback": (
                f"ollama:{brain.OLLAMA_MODEL}" if ollama_ok else None
            ),
            "llm_last": brain.LAST_ENGINE or None,
            "stt": f"groq:{brain.STT_MODEL}",
            "tts_local": kokoro_ok,
            "vision_local": True,
        },
    }


@app.post("/api/chat")
async def chat(req: ChatRequest) -> dict:
    started = time.time()
    try:
        reply = brain.chat(req.message)
    except Exception as exc:
        raise HTTPException(502, f"LLM failed: {exc}") from exc

    try:
        audio_url = await synthesize_audio(reply)
    except Exception as exc:
        print(f"  [tts] synthesize_audio failed: {exc}")
        audio_url = ""
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
    file: UploadFile = File(...),
    persona: str = Form("standard"),
    jd: str = Form(""),
) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    started = time.time()
    try:
        result = coach.load_resume(
            file.filename or "resume.pdf", data, persona_id=persona, jd=jd
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
    try:
        audio_url = await synthesize_audio(intro, voice=coach.persona_voice())
    except Exception as exc:
        print(f"  [tts] resume audio failed: {exc}")
        audio_url = ""
    return {
        **result,
        "persona_info": coach.persona_public(coach._state["persona"]),
        "current_question": first,
        "audio_url": audio_url,
    }


@app.post("/api/interview/persona")
async def interview_persona(req: ChatRequest) -> dict:
    try:
        coach.set_persona(req.message)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    info = coach.persona_public(coach._state["persona"])
    preset_file = AUDIO_DIR / f"persona_{req.message}.wav"
    if preset_file.exists() and preset_file.stat().st_size > 0:
        # version by mtime so a regenerated greeting is never served from cache
        audio_url = f"/static/audio/{preset_file.name}?v={int(preset_file.stat().st_mtime)}"
    else:
        greeting = f"Switching mode. I'm now {info['label']}. {info['tagline']}."
        try:
            audio_url = await synthesize_audio(greeting, voice=coach.persona_voice())
        except Exception as exc:
            print(f"  [tts] persona audio failed: {exc}")
            audio_url = ""
    return {
        "persona": info,
        "audio_url": audio_url,
    }


@app.post("/api/interview/answer")
async def interview_answer(req: ChatRequest) -> dict:
    started = time.time()
    try:
        result = coach.score_answer(
            req.message, setup=req.setup, edited=req.edited
        )
    except Exception as exc:
        raise HTTPException(502, f"scoring failed: {exc}") from exc
    spoken = result.get("spoken_feedback") or result.get("verdict") or ""
    print(
        f"  [interview] answer scored in {time.time() - started:.1f}s "
        f"({result['score']}/100, {coach._state['persona']})"
    )
    try:
        audio_url = await synthesize_audio(spoken, voice=coach.persona_voice())
    except Exception as exc:
        print(f"  [tts] answer audio failed: {exc}")
        audio_url = ""
    return {
        **result,
        "audio_url": audio_url,
    }


@app.post("/api/interview/retry")
async def interview_retry(req: ChatRequest) -> dict:
    """Re-answer an earlier question and return what changed since attempt 1."""
    if req.question_id is None:
        raise HTTPException(400, "question_id is required to retry")
    started = time.time()
    try:
        result = coach.retry_answer(
            req.question_id,
            req.message,
            setup=req.setup,
            edited=req.edited,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"retry scoring failed: {exc}") from exc
    spoken = result.get("spoken_feedback") or result.get("verdict") or ""
    print(
        f"  [interview] retry scored in {time.time() - started:.1f}s "
        f"(attempt {result['attempt']}, {result['score']}/100)"
    )
    try:
        audio_url = await synthesize_audio(spoken, voice=coach.persona_voice())
    except Exception as exc:
        print(f"  [tts] retry audio failed: {exc}")
        audio_url = ""
    return {**result, "audio_url": audio_url}


@app.post("/api/interview/jd")
async def interview_jd(req: ChatRequest) -> dict:
    """Ground the question set in a pasted job description."""
    started = time.time()
    try:
        result = coach.set_jd(req.message)
    except Exception as exc:
        raise HTTPException(
            400, f"could not ground questions in that JD: {exc}"
        ) from exc
    print(f"  [interview] JD grounded in {time.time() - started:.1f}s")
    return {**result, "current_question": coach.current_question()}


@app.get("/api/interview/state")
async def interview_state() -> dict:
    return {**coach.state(), "current_question": coach.current_question()}


@app.post("/api/interview/reset")
async def interview_reset() -> dict:
    coach.reset()
    return {"ok": True}


# ------------------------------------------------------- local practice history

@app.get("/api/history")
async def history() -> dict:
    """Local, on-device practice history. Exportable, deletable, never uploaded."""
    try:
        return {
            "sessions": store.sessions(),
            "competencies": store.competency_history(),
            "weak": store.weak_competencies(),
            "behaviour": store.behaviour_stats(),
            "db_path": str(store.DB_PATH),
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"history unavailable: {exc}") from exc


@app.get("/api/eval/error-bars")
async def eval_error_bars() -> dict:
    """Published validation numbers for Aria's scores. Read-only.

    Generated offline by ``scripts/errorbars.py`` (developer tooling); the
    candidate never rates anything. Returns ``available: False`` until the
    benchmark has been scored.
    """
    try:
        report = errorbars.load_report()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"could not read the report: {exc}") from exc
    if not report:
        return {"available": False}
    return {"available": True, **report}


@app.get("/api/history/export")
async def history_export() -> dict:
    try:
        return store.export_json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"export failed: {exc}") from exc


@app.post("/api/history/import")
async def history_import(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, "invalid JSON body") from exc
    try:
        return {**store.import_json(data), "ok": True}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"import failed: {exc}") from exc


@app.post("/api/history/clear")
async def history_clear() -> dict:
    try:
        store.clear()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"could not clear history: {exc}") from exc
    return {"ok": True}


@app.get("/api/history/session/{session_id}")
async def history_session(session_id: int) -> dict:
    try:
        return store.session_detail(session_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


# serve generated audio BEFORE the SPA catch-all mount
app.mount("/static", StaticFiles(directory=str(_PROJECT_ROOT / "static")), name="static")
# serve frontend build last (catch-all)
app.mount("/", StaticFiles(directory=str(_PROJECT_ROOT / "frontend" / "dist"), html=True), name="spa")
