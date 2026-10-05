"""Observable speech-delivery metrics for a spoken interview answer.

Everything here is counted from the transcript and the recorded duration —
words per minute, filler frequency, restarts, answer length. These are
*coaching signals*, phrased as behaviour ("you used 11 fillers in 90 seconds"),
never as diagnoses ("you were nervous"). Aria does not read confidence,
nervousness or emotion from a face or a voice, and none of these numbers touch
the interview score.

The metrics are deterministic: the same transcript and duration always produce
the same numbers, so any judge can recompute them by hand.
"""

from __future__ import annotations

import re

# Common spoken fillers (English). Counted, never judged.
_FILLER_RE = re.compile(
    r"\b(?:um+|uh+|erm+|ah+|er+|like|you know|i mean|sort of|kind of|"
    r"basically|actually|literally|right\?|okay so|so yeah)\b",
    re.IGNORECASE,
)

# A restart: the candidate abandons a fragment mid-way and begins again.
_RESTART_RE = re.compile(
    r"(?:^|(?<=[.!?])\s)(?:sorry|no wait|actually|let me|wait|i mean)\b",
    re.IGNORECASE,
)

_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]?")

# A comfortable interview pace is roughly 120-175 wpm (conversational range);
# above ~190 listeners start losing words, below ~110 it can sound rehearsed.
# These are coaching bands, not pass/fail.
COMFORTABLE_WPM = (120, 175)


def analyse(answer: str, duration_s: float | None = None) -> dict:
    """Observable delivery metrics for one spoken answer. Pure function."""
    text = (answer or "").strip()
    words = re.findall(r"[A-Za-z0-9'%-]+", text)
    word_count = len(words)
    fillers = [m.group(0).lower() for m in _FILLER_RE.finditer(text)]
    sentences = [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]
    duration = float(duration_s) if duration_s and duration_s > 0.5 else None

    wpm = round(word_count / (duration / 60), 1) if duration and word_count else None
    fillers_per_100 = (
        round(len(fillers) * 100 / word_count, 1) if word_count else 0.0
    )
    longest_sentence = max((len(s.split()) for s in sentences), default=0)

    notes: list[str] = []
    if duration and word_count and wpm:
        if wpm > COMFORTABLE_WPM[1] + 15:
            notes.append(
                f"Pace: {wpm:.0f} words per minute — fast enough that listeners "
                "can lose detail. Try a one-second pause between points."
            )
        elif wpm < COMFORTABLE_WPM[0] - 25:
            notes.append(
                f"Pace: {wpm:.0f} words per minute — slow enough that energy can "
                "drop. Rehearse the opening sentence so it flows."
            )
    if len(fillers) >= 4 and word_count >= 30:
        tail = f" in {duration:.0f} seconds" if duration else " in this answer"
        notes.append(
            f"You used {len(fillers)} filler word(s){tail}. Replace the next "
            "one with a silent beat — silence reads as composure."
        )
    if longest_sentence > 45:
        notes.append(
            f"Your longest sentence ran {longest_sentence} words. Split it: one "
            "idea per sentence lands harder out loud."
        )
    if duration and word_count < 25 and duration > 20:
        notes.append(
            f"{duration:.0f} seconds with only {word_count} words — long gaps "
            "suggest searching for the story. Prepare the opening sentence of "
            "each resume story."
        )

    return {
        "words": word_count,
        "duration_s": round(duration, 1) if duration else None,
        "wpm": wpm,
        "filler_count": len(fillers),
        "fillers_per_100_words": fillers_per_100,
        "top_fillers": _top(fillers),
        "restarts": len(_RESTART_RE.findall(text)),
        "longest_sentence_words": longest_sentence,
        # Coaching signals only. Not a score, not a diagnosis, never graded.
        "notes": notes[:3],
        "source": "transcript + recorded duration (observable behaviour only)",
    }


def _top(fillers: list[str], limit: int = 3) -> list[dict]:
    counts: dict[str, "str"] = {}
    for f in fillers:
        counts[f] = counts.get(f, 0) + 1
    return [
        {"word": w, "count": c}
        for w, c in sorted(counts.items(), key=lambda kv: -kv[1])[:limit]
    ]
