"""Deterministic, inspectable features of a spoken interview answer.

This is the project's own reference instrument for the published error bars:
no model, no sampling, no human. Every feature is a regex or a count, so the
same text always produces the same numbers and any judge can check a claim by
hand.

The features back a *convergent-validity* test. When a candidate adds a
concrete number, Aria's evidence score should go up; when they switch from "we"
to "I", the ownership score should go up; when they hedge, evidence should go
down. If Aria's numbers do not move with these objective properties of the
text, the score is decorative — and we say so.
"""

from __future__ import annotations

import re

_NUMBER_RE = re.compile(r"\d[\d,.]*")
_QUANTIFIED_RE = re.compile(
    r"\b\d[\d,.]*\s?"
    r"(?:%|percent|x\b|k\b|m\b|ms\b|s\b|sec|seconds?|min|minutes?|hours?|hrs?|"
    r"days?|weeks?|months?|years?|users?|customers?|people|requests?|releases?)\b",
    re.IGNORECASE,
)
_I_RE = re.compile(r"\b(?:i|my|mine|myself)\b", re.IGNORECASE)
_WE_RE = re.compile(r"\b(?:we|our|ours|us)\b", re.IGNORECASE)
_STAR_RE = re.compile(
    r"\b(?:situation|task|goal|objective|challenge|action|result|outcome|impact|"
    r"because|so that|which meant|as a result|the upshot|i learned|i now)\b",
    re.IGNORECASE,
)
_HEDGE_RE = re.compile(
    r"\b(?:things?|stuff|some|several|a lot|kind of|sort of|maybe|probably|"
    r"basically|literally|whatever|etc)\b",
    re.IGNORECASE,
)
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]?")

# feature -> plain-language description shown next to the correlation
FEATURE_LABELS = {
    "words": "answer length (words)",
    "numbers": "concrete numbers used",
    "quantified": "numbers with a unit or outcome",
    "ownership_ratio": "share of I/my vs we/our",
    "star_signals": "STAR / result signposting",
    "hedges": "vague hedging words",
    "avg_sentence_words": "average sentence length",
}

# The validity claims Aria makes, as testable hypotheses. `expected` is the
# sign of the Spearman correlation between the objective feature and the
# dimension's mean score across the benchmark answers.
HYPOTHESES = [
    {
        "dimension": "specificity_evidence",
        "feature": "quantified",
        "expected": "+",
        "label": "more quantified outcomes should raise the evidence score",
    },
    {
        "dimension": "impact_ownership",
        "feature": "ownership_ratio",
        "expected": "+",
        "label": "saying I rather than we should raise the ownership score",
    },
    {
        "dimension": "relevance_structure",
        "feature": "star_signals",
        "expected": "+",
        "label": "STAR signposting should raise the structure score",
    },
    {
        "dimension": "specificity_evidence",
        "feature": "hedges",
        "expected": "-",
        "label": "vague hedging should lower the evidence score",
    },
]


def extract(text: str) -> dict:
    """Deterministic feature vector for one answer. Pure function."""
    text = text or ""
    words = re.findall(r"[A-Za-z0-9'%-]+", text)
    sentences = [s for s in (m.group(0).strip() for m in _SENTENCE_RE.finditer(text)) if s]
    i_count = len(_I_RE.findall(text))
    we_count = len(_WE_RE.findall(text))
    first_person = i_count + we_count
    return {
        "words": len(words),
        "numbers": len(_NUMBER_RE.findall(text)),
        "quantified": len(_QUANTIFIED_RE.findall(text)),
        "i_count": i_count,
        "we_count": we_count,
        "ownership_ratio": (
            round(i_count / first_person, 4) if first_person else 0.0
        ),
        "star_signals": len(_STAR_RE.findall(text)),
        "hedges": len(_HEDGE_RE.findall(text)),
        "sentences": len(sentences),
        "avg_sentence_words": (
            round(len(words) / len(sentences), 2) if sentences else 0.0
        ),
    }
