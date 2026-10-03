"""Local, on-device practice history (SQLite).

Deliberately **not** a hosted store. The brief asks for on-device, data-secure
guidance, and this table holds findings about a student's resume and their
verbatim interview transcripts. So it lives in a single local file that the
candidate can export, inspect or delete — nothing here is ever uploaded.

The DB is optional infrastructure: if it cannot be opened, callers swallow the
error and the interview still works.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("ARIA_DB") or _PROJECT_ROOT / "aria_history.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT    NOT NULL DEFAULT '',
    filename   TEXT    NOT NULL DEFAULT '',
    persona    TEXT    NOT NULL DEFAULT '',
    has_jd     INTEGER NOT NULL DEFAULT 0,
    profile    TEXT    NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT '',
    question_id INTEGER NOT NULL DEFAULT 0,
    question    TEXT    NOT NULL DEFAULT '',
    competency  TEXT    NOT NULL DEFAULT '',
    qtype       TEXT    NOT NULL DEFAULT '',
    persona     TEXT    NOT NULL DEFAULT '',
    attempt     INTEGER NOT NULL DEFAULT 1,
    edited      INTEGER NOT NULL DEFAULT 0,
    score       INTEGER NOT NULL DEFAULT 0,
    breakdown   TEXT    NOT NULL DEFAULT '{}',
    answer      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_competency ON answers(competency);
-- Free-chat transcript. Tracked for the same reason as the practice tables:
-- the user should be able to see, export and delete what they said.
CREATE TABLE IF NOT EXISTS chat_turns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT    NOT NULL DEFAULT '',
    session    INTEGER NOT NULL DEFAULT 1,
    prompt     TEXT    NOT NULL DEFAULT '',
    reply      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_turns(session);
-- Monotonic conversation counter. It has to be stored rather than derived from
-- MAX(session), otherwise "New session" before the first turn hands out the
-- same id twice and two conversations collapse into one.
CREATE TABLE IF NOT EXISTS store_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
-- Published error bars: repeated scoring runs over the fixed eval set, plus
-- optional runs from an independent judge model. Kept apart from the personal
-- practice tables so clearing one's practice history never destroys the eval
-- artifact.
CREATE TABLE IF NOT EXISTS eval_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT    NOT NULL DEFAULT '',
    answer_id  INTEGER NOT NULL DEFAULT 0,
    run        INTEGER NOT NULL DEFAULT 1,
    score      INTEGER NOT NULL DEFAULT 0,
    breakdown  TEXT    NOT NULL DEFAULT '{}',
    engine     TEXT    NOT NULL DEFAULT '',
    source     TEXT    NOT NULL DEFAULT 'aria'
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_answer ON eval_runs(answer_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_source ON eval_runs(source);
"""

_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Bring an older local DB up to the current schema.

    `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a column
    added later (the eval `source`) has to be patched in explicitly.
    """
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(eval_runs)").fetchall()
    }
    if columns and "source" not in columns:
        conn.execute(
            "ALTER TABLE eval_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'aria'"
        )
    # an earlier revision of the eval schema; superseded and never written to
    conn.execute("DROP TABLE IF EXISTS eval_ratings")


def _ensure() -> None:
    global _ready
    if _ready:
        return
    conn = _connect()
    try:
        # migrate first: the schema script creates an index on a column that an
        # older DB may not have yet
        _migrate(conn)
        conn.executescript(_SCHEMA)
        conn.commit()
    finally:
        conn.close()
    _ready = True


@contextmanager
def _db():
    _ensure()
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _insert_answer(conn: sqlite3.Connection, session_id: int, a: dict) -> int:
    breakdown = a.get("breakdown")
    if not isinstance(breakdown, str):
        breakdown = json.dumps(breakdown or {})
    cur = conn.execute(
        """INSERT INTO answers
           (session_id, created_at, question_id, question, competency, qtype,
            persona, attempt, edited, score, breakdown, answer)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            int(session_id or 0),
            str(a.get("created_at") or _now()),
            int(a.get("question_id") or 0),
            str(a.get("question") or "")[:600],
            str(a.get("competency") or "")[:80],
            str(a.get("qtype") or "")[:40],
            str(a.get("persona") or ""),
            int(a.get("attempt") or 1),
            1 if a.get("edited") else 0,
            int(a.get("score") or 0),
            breakdown,
            str(a.get("answer") or "")[:8000],
        ),
    )
    return int(cur.lastrowid)


# ------------------------------------------------------------------ write side


def start_session(
    filename: str, persona: str, has_jd: bool, profile: str
) -> int:
    with _db() as conn:
        cur = conn.execute(
            """INSERT INTO sessions (created_at, filename, persona, has_jd, profile)
               VALUES (?,?,?,?,?)""",
            (
                _now(),
                str(filename or "")[:300],
                str(persona or ""),
                1 if has_jd else 0,
                str(profile or "")[:400],
            ),
        )
        return int(cur.lastrowid)


def update_answer(row_id: int, record: dict) -> None:
    """Replace a stored answer in place after a transcript correction.

    A correction is not a new attempt, so it updates the existing row (and marks
    it edited) rather than inserting another one.
    """
    breakdown = record.get("breakdown")
    if not isinstance(breakdown, str):
        breakdown = json.dumps(breakdown or {})
    with _db() as conn:
        conn.execute(
            """UPDATE answers
               SET answer = ?, score = ?, breakdown = ?, edited = 1
               WHERE id = ?""",
            (
                str(record.get("answer") or "")[:8000],
                int(record.get("score") or 0),
                breakdown,
                int(row_id or 0),
            ),
        )


def save_answer(session_id: int | None, record: dict) -> int:
    with _db() as conn:
        return _insert_answer(conn, session_id or 0, record)


def clear() -> None:
    with _db() as conn:
        conn.execute("DELETE FROM answers")
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM chat_turns")
        conn.execute("DELETE FROM store_meta")


# ------------------------------------------------------------------- read side


def sessions(limit: int = 20) -> list[dict]:
    with _db() as conn:
        rows = conn.execute(
            """SELECT s.id, s.created_at, s.filename, s.persona, s.has_jd,
                      s.profile,
                      COUNT(a.id) AS answers,
                      COALESCE(ROUND(AVG(a.score), 1), 0) AS avg_score
               FROM sessions s
               LEFT JOIN answers a ON a.session_id = s.id
               GROUP BY s.id
               ORDER BY s.id DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def session_detail(session_id: int) -> dict:
    with _db() as conn:
        session = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if session is None:
            raise ValueError("no such session")
        rows = conn.execute(
            "SELECT * FROM answers WHERE session_id = ? ORDER BY id", (session_id,)
        ).fetchall()
    answers = []
    for row in rows:
        item = dict(row)
        try:
            item["breakdown"] = json.loads(item.get("breakdown") or "{}")
        except json.JSONDecodeError:
            item["breakdown"] = {}
        answers.append(item)
    return {"session": dict(session), "answers": answers}


def competency_history() -> list[dict]:
    """Per-competency aggregate across every session, weakest average first."""
    with _db() as conn:
        rows = conn.execute(
            """SELECT competency, score FROM answers
               WHERE competency <> '' ORDER BY id"""
        ).fetchall()
    stats: dict[str, dict] = {}
    for row in rows:
        name = row["competency"]
        score = int(row["score"] or 0)
        entry = stats.setdefault(
            name,
            {
                "competency": name,
                "attempts": 0,
                "total": 0,
                "best": 0,
                "worst": 100,
                "first": score,
                "last": score,
            },
        )
        entry["attempts"] += 1
        entry["total"] += score
        entry["best"] = max(entry["best"], score)
        entry["worst"] = min(entry["worst"], score)
        entry["last"] = score
    out: list[dict] = []
    for entry in stats.values():
        total = entry.pop("total")
        entry["avg_score"] = round(total / max(1, entry["attempts"]), 1)
        entry["trend"] = entry["last"] - entry["first"]
        out.append(entry)
    out.sort(key=lambda e: e["avg_score"])
    return out


def weak_competencies(threshold: int = 60, limit: int = 3) -> list[str]:
    """Competencies worth re-queuing (spaced practice), weakest first."""
    history = competency_history()
    weak = [h["competency"] for h in history if h["avg_score"] < threshold]
    return weak[:limit]


def attempts_for(session_id: int | None, question_id: int | None) -> int:
    """How many times this question has already been answered in this session.

    Used to number a retry attempt: the first answer is attempt 1, so a retry
    is `attempts_for(...) + 1`. Falls back to 0 when history is unavailable.
    """
    with _db() as conn:
        row = conn.execute(
            """SELECT COUNT(*) c FROM answers
               WHERE session_id = ? AND question_id = ?""",
            (int(session_id or 0), int(question_id or 0)),
        ).fetchone()
    return int(row["c"] or 0)


def behaviour_stats() -> dict:
    """Confidence measured as behaviour chosen - never inferred from a face."""
    with _db() as conn:
        answered = conn.execute("SELECT COUNT(*) c FROM answers").fetchone()["c"]
        corrected = conn.execute(
            "SELECT COUNT(*) c FROM answers WHERE edited = 1"
        ).fetchone()["c"]
        session_count = conn.execute(
            "SELECT COUNT(*) c FROM sessions"
        ).fetchone()["c"]
        retried = conn.execute(
            """SELECT COUNT(*) c FROM (
                   SELECT session_id, question_id FROM answers
                   GROUP BY session_id, question_id HAVING COUNT(*) > 1
               )"""
        ).fetchone()["c"]
        improved = conn.execute(
            """SELECT COUNT(*) c FROM (
                   SELECT MAX(score) mx, MIN(score) mn FROM answers
                   GROUP BY session_id, question_id HAVING COUNT(*) > 1
               ) WHERE mx > mn"""
        ).fetchone()["c"]
    return {
        "sessions": int(session_count),
        "answered": int(answered),
        "corrected": int(corrected),
        "retried": int(retried),
        "improved": int(improved),
    }


# ------------------------------------------------------------------ free chat


def start_chat_session() -> int:
    """Open the next conversation number, so turns group into sessions."""
    with _db() as conn:
        row = conn.execute(
            "SELECT value FROM store_meta WHERE key = 'chat_session'"
        ).fetchone()
        if row is not None:
            nxt = int(row["value"] or 0) + 1
        else:
            highest = int(
                conn.execute(
                    "SELECT COALESCE(MAX(session), 0) s FROM chat_turns"
                ).fetchone()["s"]
            )
            nxt = highest + 1
        conn.execute(
            """INSERT INTO store_meta (key, value) VALUES ('chat_session', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (str(nxt),),
        )
    return nxt


def save_chat_turn(prompt: str, reply: str, session: int = 1) -> int:
    with _db() as conn:
        cur = conn.execute(
            """INSERT INTO chat_turns (created_at, session, prompt, reply)
               VALUES (?,?,?,?)""",
            (
                _now(),
                int(session or 1),
                str(prompt or "")[:4000],
                str(reply or "")[:4000],
            ),
        )
        return int(cur.lastrowid)


def chat_sessions(limit: int = 20) -> list[dict]:
    """Recent conversations, newest first, with a preview line."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT session, created_at, prompt FROM chat_turns ORDER BY id"
        ).fetchall()
    grouped: dict[int, dict] = {}
    for row in rows:
        session = int(row["session"])
        entry = grouped.setdefault(
            session,
            {
                "session": session,
                "turns": 0,
                "started_at": row["created_at"],
                "preview": str(row["prompt"])[:120],
            },
        )
        entry["turns"] += 1
    ordered = sorted(grouped.values(), key=lambda g: g["session"], reverse=True)
    return ordered[:limit]


def chat_count() -> int:
    with _db() as conn:
        return int(conn.execute("SELECT COUNT(*) c FROM chat_turns").fetchone()["c"])


def chat_turns_for(session: int) -> list[dict]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT created_at, prompt, reply FROM chat_turns WHERE session = ? ORDER BY id",
            (int(session),),
        ).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------- export/import


def export_json() -> dict:
    with _db() as conn:
        session_rows = [
            dict(r) for r in conn.execute("SELECT * FROM sessions ORDER BY id")
        ]
        answer_rows = [
            dict(r) for r in conn.execute("SELECT * FROM answers ORDER BY id")
        ]
        chat_rows = [
            dict(r) for r in conn.execute("SELECT * FROM chat_turns ORDER BY id")
        ]
    return {
        "version": 1,
        "exported_at": _now(),
        "sessions": session_rows,
        "answers": answer_rows,
        "chat_turns": chat_rows,
    }


def save_aria_run(
    answer_id: int,
    run: int,
    score: int,
    breakdown: dict | str,
    engine: str = "",
    source: str = "aria",
) -> None:
    payload = breakdown if isinstance(breakdown, str) else json.dumps(breakdown or {})
    with _db() as conn:
        conn.execute(
            """INSERT INTO eval_runs
               (created_at, answer_id, run, score, breakdown, engine, source)
               VALUES (?,?,?,?,?,?,?)""",
            (
                _now(),
                int(answer_id or 0),
                int(run or 1),
                int(score or 0),
                payload,
                str(engine or ""),
                str(source or "aria")[:40],
            ),
        )


def aria_runs(source: str | None = None) -> list[dict]:
    """All eval runs, or only one rater's when `source` is given."""
    query = "SELECT answer_id, run, score, breakdown, engine, source FROM eval_runs"
    params: tuple = ()
    if source is not None:
        query += " WHERE source = ?"
        params = (source,)
    query += " ORDER BY answer_id, run"
    with _db() as conn:
        rows = conn.execute(query, params).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        try:
            item["breakdown"] = json.loads(item.get("breakdown") or "{}")
        except json.JSONDecodeError:
            item["breakdown"] = {}
        out.append(item)
    return out


def clear_eval_runs_for(answer_id: int, source: str = "aria") -> None:
    """Drop one answer's runs for one rater, so re-running the eval is idempotent."""
    with _db() as conn:
        conn.execute(
            "DELETE FROM eval_runs WHERE answer_id = ? AND source = ?",
            (int(answer_id or 0), str(source or "aria")),
        )


def eval_run_count(answer_id: int, source: str = "aria") -> int:
    with _db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) c FROM eval_runs WHERE answer_id = ? AND source = ?",
            (int(answer_id or 0), str(source or "aria")),
        ).fetchone()
    return int(row["c"] or 0)


def eval_sources() -> list[str]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT source FROM eval_runs WHERE source <> '' ORDER BY source"
        ).fetchall()
    return [r["source"] for r in rows]


def clear_aria_runs(source: str | None = None) -> None:
    with _db() as conn:
        if source:
            conn.execute("DELETE FROM eval_runs WHERE source = ?", (source,))
        else:
            conn.execute("DELETE FROM eval_runs")


def import_json(data: dict) -> dict:
    sessions_in = data.get("sessions") or []
    answers_in = data.get("answers") or []
    id_map: dict[int, int] = {}
    with _db() as conn:
        for s in sessions_in:
            cur = conn.execute(
                """INSERT INTO sessions (created_at, filename, persona, has_jd, profile)
                   VALUES (?,?,?,?,?)""",
                (
                    str(s.get("created_at") or _now()),
                    str(s.get("filename") or "")[:300],
                    str(s.get("persona") or ""),
                    int(s.get("has_jd") or 0),
                    str(s.get("profile") or "")[:400],
                ),
            )
            id_map[int(s.get("id") or 0)] = int(cur.lastrowid)
        for a in answers_in:
            _insert_answer(conn, id_map.get(int(a.get("session_id") or 0), 0), a)
        # chat sessions are plain integers, so offset them to avoid colliding
        # with conversations already on this device
        chat_in = data.get("chat_turns") or []
        row = conn.execute("SELECT COALESCE(MAX(session), 0) s FROM chat_turns").fetchone()
        offset = int(row["s"] or 0)
        for t in chat_in:
            conn.execute(
                """INSERT INTO chat_turns (created_at, session, prompt, reply)
                   VALUES (?,?,?,?)""",
                (
                    str(t.get("created_at") or _now()),
                    int(t.get("session") or 1) + offset,
                    str(t.get("prompt") or "")[:4000],
                    str(t.get("reply") or "")[:4000],
                ),
            )
        # keep the counter ahead of anything just imported
        highest = int(
            conn.execute("SELECT COALESCE(MAX(session), 0) s FROM chat_turns").fetchone()["s"]
        )
        conn.execute(
            """INSERT INTO store_meta (key, value) VALUES ('chat_session', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (str(highest),),
        )
    return {
        "sessions": len(sessions_in),
        "answers": len(answers_in),
        "chat_turns": len(chat_in),
    }
