"""Aria backend: FastAPI wrapper around the Groq + Kokoro pipeline."""

from __future__ import annotations

import asyncio
import contextlib
import glob
import os
import re
import shutil
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import brain, coach, errorbars, store, tts

# Only the app's own origins may call this API cross-origin. The served frontend
# is same-origin and needs no CORS at all; the dev server reaches the backend
# through the Vite proxy. A wildcard previously let any website the user has
# open read /api/history (practice transcripts) from their local machine.
LOCAL_ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]

# Hard ceiling for one uploaded resume: a resume is a few hundred KB; 15 MB
# covers any legitimate PDF while capping memory exhaustion from a hostile body.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


def _validate_upload(filename: str, data: bytes) -> None:
    """Reject files this parser genuinely cannot read, with actionable errors.

    Extension claims are not trusted; the bytes are sniffed. DOCX (a zip) is
    rejected up front with guidance instead of being mangled into mojibake.
    """
    name = (filename or "").lower()
    if data[:4] == b"%PDF":
        if not name.endswith(".pdf"):
            pass  # content is a PDF regardless of the name; let the parser try
        return
    if data[:2] == b"PK":
        raise HTTPException(
            400,
            "That looks like a .docx (Word) file. Export it as PDF from Word "
            "(`Save as PDF`) and upload that — PDF and TXT work best.",
        )
    if name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
        raise HTTPException(
            400,
            "Images are not supported directly. Put the photo into a PDF or a "
            "text file and upload that.",
        )
    # text-ish check: a real resume is overwhelmingly printable
    sample = data[:8192]
    if not sample:
        raise HTTPException(400, "empty file")
    null_bytes = sample.count(0)
    if null_bytes > len(sample) * 0.05:
        raise HTTPException(
            400, "unsupported binary file — upload a PDF or TXT resume"
        )

# Cheap in-memory sliding-window limiter for the expensive endpoints (each one
# spends a Groq/local-model round-trip). This is a local single-user app: the
# point is stopping a runaway tab or script from burning the API key, not
# multi-tenant quota.
_RATE_LIMIT = 30  # requests...
_RATE_WINDOW = 60.0  # ...per this many seconds, per ip+route
_rate_buckets: dict[str, deque] = defaultdict(deque)


def _rate_limit(request: Request, route: str) -> None:
    key = f"{request.client.host if request.client else '?'}:{route}"
    now = time.monotonic()
    bucket = _rate_buckets[key]
    while bucket and now - bucket[0] > _RATE_WINDOW:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT:
        raise HTTPException(429, "too many requests — slow down for a second")
    bucket.append(now)


_SESSION_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


def _client_session(request: Request) -> str:
    """The client session id for this request (one stable id per browser tab).

    Interview state and free-chat history are scoped to it, so two tabs can
    never overwrite each other. Falls back to a shared default for old clients.
    """
    raw = request.headers.get("x-session-id", "")
    return raw if _SESSION_RE.fullmatch(raw) else "default"


def _history_token() -> str:
    """The session id bound for the running request (falls back to default)."""
    try:
        return str(brain._history_var.get())
    except Exception:  # noqa: BLE001 - never break chat over bookkeeping
        return "default"


@contextlib.contextmanager
def session_scope(request: Request):
    """Bind interview + chat state to this request's client session id."""
    sid = _client_session(request)
    t1 = coach.bind_session(sid)
    t2 = brain.bind_chat_session(sid)
    try:
        yield sid
    finally:
        coach._sid_var.reset(t1)
        brain._history_var.reset(t2)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_audio_cleanup_loop())
    if brain.OFFLINE_ONLY:
        # Pre-load the local whisper model so the first spoken answer in an
        # offline demo doesn't pay the one-time load cost.
        def _warm() -> None:
            try:
                brain._get_whisper()
                print("  [stt] local whisper warmed up")
            except Exception as exc:  # noqa: BLE001
                print(f"  [stt] local whisper warm-up failed: {exc}")

        threading.Thread(target=_warm, daemon=True).start()
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


async def _audio_cleanup_loop() -> None:
    """Prune generated speech files: every recording-derived utterance is
    effectively PII on disk, so nothing but persona greetings may persist."""
    while True:
        _prune_audio_files()
        await asyncio.sleep(900)


def _prune_audio_files() -> None:
    try:
        files = [
            p
            for p in AUDIO_DIR.iterdir()
            if p.is_file() and not p.name.startswith("persona_")
        ]
        cutoff = time.time() - 3600  # one hour is plenty for playback retries
        for p in files:
            try:
                if p.stat().st_mtime < cutoff:
                    p.unlink(missing_ok=True)
            except OSError:
                continue
        # even fresh files must stay bounded
        fresh = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)
        for p in fresh[100:]:
            p.unlink(missing_ok=True)
    except OSError:
        pass


app = FastAPI(title="Aria backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Session-Id"],
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
    # the candidate corrected the transcript after scoring (behaviour, not a face)
    edited: bool = False
    # set when re-answering a specific question (retry / spaced practice)
    question_id: int | None = None
    # "voice" when this came from the microphone, "typed" otherwise
    source: str = "typed"
    # seconds the candidate spoke (from the browser recorder) — used for the
    # observable pace metrics; never treated as evidence of anything else
    duration_s: float | None = None


# Which free-chat conversation new turns belong to, per client session. Opened
# lazily on first use and rolled forward by "New session", so the transcript
# groups into sessions.
_chat_sessions: dict[str, int] = {}


def _open_chat_session() -> int:
    try:
        return store.start_chat_session()
    except Exception as exc:  # noqa: BLE001 - history must never break chat
        print(f"  [store] could not open a chat session: {exc}")
        return 1


def _remember_chat_turn(prompt: str, reply: str) -> None:
    """Record one free-chat exchange locally. Never fatal."""
    sid = _history_token()
    if sid not in _chat_sessions:
        _chat_sessions[sid] = _open_chat_session()
    try:
        store.save_chat_turn(prompt, reply, _chat_sessions[sid])
    except Exception as exc:  # noqa: BLE001
        print(f"  [store] could not save the chat turn: {exc}")


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict:
    _rate_limit(request, "transcribe")
    raw = await request.body()
    if not raw:
        raise HTTPException(400, "empty audio body")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(413, "audio too large")
    mime = request.headers.get("content-type", "audio/webm")
    started = time.time()
    try:
        wav = _to_wav_bytes(raw, mime)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
    try:
        text = await asyncio.to_thread(brain.transcribe, wav)
    except Exception as exc:
        raise HTTPException(502, f"transcription failed: {exc}") from exc
    # Never log the transcript itself: it is the user's spoken words.
    print(f"  [stt] {time.time() - started:.1f}s -> {len(text)} chars ({brain.LAST_STT_ENGINE})")
    return {"text": text}


async def synthesize_audio(text: str, voice: str | None = None) -> str:
    """Render text with Kokoro ONNX (local, on-device) and return the served audio URL.

    There is deliberately no cloud TTS fallback: sending the coach's replies
    (which quote the candidate's own words) to a third-party speech service for
    convenience would break the privacy stance for zero product gain. If the
    local engine fails the UI falls back to text, which it already handles.
    """
    clean_text = tts._clean(text)
    if not clean_text:
        clean_text = text

    filename = f"{uuid.uuid4().hex}.wav"
    dest = AUDIO_DIR / filename

    try:
        samples, sr = await asyncio.to_thread(tts.generate, clean_text, voice)
        if len(samples) > 0:
            sf.write(str(dest), samples, sr)
            return f"/static/audio/{filename}"
    except Exception as exc:
        print(f"  [tts] Kokoro ONNX failed ({type(exc).__name__}: {exc}) — returning text only")

    # Last resort: short silent WAV so the audio element never hangs the UI.
    try:
        sf.write(str(dest), np.zeros(4000, dtype="float32"), 24000)
    except Exception as exc:
        print(f"  [tts] silent fallback failed: {exc}")
    return f"/static/audio/{filename}"


def _local_stt_ready() -> bool:
    """True when the on-device whisper model is present (or already loaded)."""
    if brain._whisper_model is not None:
        return True
    try:
        import faster_whisper  # noqa: F401

        return True
    except ImportError:
        return False


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
        "offline_mode": brain.OFFLINE_ONLY,
        "local_stt_ready": _local_stt_ready(),
        # Honest account of where each task runs. Cloud by default where the
        # cloud is measurably better; local where local is just as good.
        "engines": {
            "llm_primary": f"groq:{brain.MODEL}" if not brain.OFFLINE_ONLY else None,
            "llm_fallback": (
                f"ollama:{brain.OLLAMA_MODEL}" if ollama_ok else None
            ),
            "llm_last": brain.LAST_ENGINE or None,
            "stt": f"groq:{brain.STT_MODEL}" if not brain.OFFLINE_ONLY else "local:whisper",
            "stt_last": brain.LAST_STT_ENGINE or None,
            "tts_local": kokoro_ok,
            "vision_local": True,
        },
    }


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request) -> dict:
    _rate_limit(request, "chat")
    started = time.time()
    with session_scope(request):
        try:
            reply = await asyncio.to_thread(brain.chat, req.message)
        except Exception as exc:
            raise HTTPException(502, f"LLM failed: {exc}") from exc

        try:
            audio_url = await synthesize_audio(reply)
        except Exception as exc:
            print(f"  [tts] synthesize_audio failed: {type(exc).__name__}: {exc}")
            audio_url = ""
        _remember_chat_turn(req.message, reply)
    print(f"  [turn] {time.time() - started:.1f}s total")
    return {"reply": reply, "audio_url": audio_url}


@app.post("/api/reset")
async def reset(request: Request) -> dict:
    with session_scope(request):
        brain.reset_history()
        chat_session = _open_chat_session()
        _chat_sessions[_history_token()] = chat_session
    return {"ok": True, "chat_session": chat_session}


# ------------------------------------------------------------- interview coach

@app.get("/api/personas")
async def personas(request: Request) -> dict:
    with session_scope(request):
        return {"personas": coach.list_personas(), "active": coach._state["persona"]}


@app.post("/api/interview/resume")
async def interview_resume(
    request: Request,
    file: UploadFile = File(...),
    persona: str = Form("standard"),
    jd: str = Form(""),
) -> dict:
    _rate_limit(request, "resume")
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413, f"file too large ({len(data) // 1024 // 1024} MB) — keep resumes under 15 MB"
        )
    _validate_upload(file.filename or "resume.pdf", data)
    started = time.time()
    with session_scope(request):
        try:
            result = await asyncio.to_thread(
                coach.load_resume,
                file.filename or "resume.pdf",
                data,
                persona_id=persona,
                jd=jd,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
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
            "engine": brain.LAST_ENGINE,
        }


@app.post("/api/interview/persona")
async def interview_persona(req: ChatRequest, request: Request) -> dict:
    _rate_limit(request, "persona")
    with session_scope(request):
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
            "engine": brain.LAST_ENGINE,
        }


@app.post("/api/interview/answer")
async def interview_answer(req: ChatRequest, request: Request) -> dict:
    _rate_limit(request, "answer")
    started = time.time()
    with session_scope(request):
        try:
            result = await asyncio.to_thread(
                coach.score_answer,
                req.message,
                setup=req.setup,
                edited=req.edited,
                source=req.source,
                duration_s=req.duration_s,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
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
            "engine": brain.LAST_ENGINE,
        }


@app.post("/api/interview/rescore")
async def interview_rescore(req: ChatRequest, request: Request) -> dict:
    """Re-score an existing answer after the transcript was corrected.

    Replaces the same attempt - it is not a retry, so the behaviour counters
    and competency averages are untouched by a misheard word.
    """
    if req.question_id is None:
        raise HTTPException(400, "question_id is required to re-score")
    started = time.time()
    with session_scope(request):
        try:
            result = await asyncio.to_thread(
                coach.rescore_answer, req.question_id, req.message
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, f"re-scoring failed: {exc}") from exc
        print(
            f"  [interview] re-scored in {time.time() - started:.1f}s "
            f"({result['score_before']} -> {result['score']}/100)"
        )
        try:
            audio_url = await synthesize_audio(
                result.get("spoken_feedback") or "",
                voice=coach.persona_voice(),
            )
        except Exception as exc:
            print(f"  [tts] rescore audio failed: {exc}")
            audio_url = ""
        return {**result, "audio_url": audio_url}


@app.post("/api/interview/retry")
async def interview_retry(req: ChatRequest, request: Request) -> dict:
    """Re-answer an earlier question and return what changed since attempt 1."""
    if req.question_id is None:
        raise HTTPException(400, "question_id is required to retry")
    started = time.time()
    with session_scope(request):
        try:
            result = await asyncio.to_thread(
                coach.retry_answer,
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
async def interview_jd(req: ChatRequest, request: Request) -> dict:
    """Ground the question set in a pasted job description."""
    _rate_limit(request, "jd")
    started = time.time()
    with session_scope(request):
        try:
            result = await asyncio.to_thread(coach.set_jd, req.message)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                400, f"could not ground questions in that JD: {exc}"
            ) from exc
        print(f"  [interview] JD grounded in {time.time() - started:.1f}s")
        return {**result, "current_question": coach.current_question()}


@app.get("/api/interview/state")
async def interview_state(request: Request) -> dict:
    with session_scope(request):
        return {**coach.state(), "current_question": coach.current_question()}


@app.post("/api/interview/reset")
async def interview_reset(request: Request) -> dict:
    with session_scope(request):
        coach.reset()
    return {"ok": True}


# ------------------------------------------------------- local practice history

@app.get("/api/history")
async def history() -> dict:
    """Local, on-device history. Exportable, deletable, never uploaded."""
    try:
        return {
            "sessions": store.sessions(),
            "competencies": store.competency_history(),
            "weak": store.weak_competencies(),
            "behaviour": store.behaviour_stats(),
            "chat": {
                "turns": store.chat_count(),
                "sessions": store.chat_sessions(),
            },
            "db_path": str(store.DB_PATH),
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"history unavailable: {exc}") from exc


@app.get("/api/progress")
async def progress() -> dict:
    """Longitudinal progress, computed from the local practice history only.

    The improvement number is arithmetic on stored attempts — if practice got
    worse, it says so. Nothing here is faked or smoothed.
    """
    try:
        sessions = store.sessions(limit=50)
        competencies = store.competency_history()
        behaviour = store.behaviour_stats()
        timeline = sorted(sessions, key=lambda s: s.get("id") or 0)
        scored = [s for s in timeline if s.get("answers", 0) > 0]
        improvement = (
            round(scored[-1]["avg_score"] - scored[0]["avg_score"], 1)
            if len(scored) >= 2
            else None
        )
        weakest = competencies[0] if competencies else None
        next_action = None
        if weakest and weakest.get("avg_score", 100) < 65:
            next_action = (
                f"Re-drill {weakest['competency']}: practice average "
                f"{weakest['avg_score']}/100 across {weakest['attempts']} "
                "attempt(s). The learning plan has the specific drill."
            )
        elif behaviour.get("answered") and not behaviour.get("improved"):
            next_action = (
                "Retry your weakest question once — the before/after diff shows "
                "exactly what changed."
            )
        return {
            "timeline": [
                {
                    "session": s["id"],
                    "date": s["created_at"],
                    "avg_score": s["avg_score"],
                    "answers": s["answers"],
                    "persona": s["persona"],
                    "has_jd": bool(s["has_jd"]),
                }
                for s in timeline
            ],
            "improvement": improvement,
            "weakest_competency": weakest,
            "next_action": next_action,
            "behaviour": behaviour,
            "computed_from": "local practice history only (aria_history.db)",
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"progress unavailable: {exc}") from exc


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


@app.get("/api/history/chat/{chat_session}")
async def history_chat(chat_session: int) -> dict:
    """Full transcript of one free-chat conversation."""
    try:
        turns = store.chat_turns_for(chat_session)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"history unavailable: {exc}") from exc
    return {"session": chat_session, "turns": turns}


# serve generated audio BEFORE the SPA catch-all mount
app.mount("/static", StaticFiles(directory=str(_PROJECT_ROOT / "static")), name="static")
# serve frontend build last (catch-all)
app.mount("/", StaticFiles(directory=str(_PROJECT_ROOT / "frontend" / "dist"), html=True), name="spa")
