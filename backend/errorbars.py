"""Automated validation and published error bars.

**Developer tooling — never part of the candidate's flow.**

Aria is built for the interviewee. Asking the person practising to grade Aria
would be circular, and it would put a research chore in front of a stressed
candidate. So this module needs no human judgement at all. It measures three
things, each with an honest name:

1. **Reliability** — Aria scored every benchmark answer several times, so we can
   publish how much it disagrees *with itself* (mean standard deviation and
   range). This is the Rating Roulette finding: the fix is to disclose variance,
   not to pretend determinism.
2. **Convergent validity** — deterministic, inspectable features of the text
   (concrete numbers, "I" vs "we", STAR signposting, hedging) against Aria's
   dimension scores. If the evidence score does not rise when a candidate adds
   real evidence, the score is decorative and we should say so.
3. **Independent-judge agreement** — a second, independent model (an on-device
   Ollama model by default) scores the same answers; we report weighted Cohen's
   kappa and Krippendorff's alpha between the two.

Nothing here runs in the request path; ``scripts/errorbars.py`` drives it, and
the app only ever reads the published ``docs/eval/error-bars.json``.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

from . import features as feature_lib
from . import stats, store

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
EVAL_DIR = _PROJECT_ROOT / "docs" / "eval"
EVAL_SET_PATH = EVAL_DIR / "eval_set.json"
REPORT_PATH = EVAL_DIR / "error-bars.json"


def _dimensions() -> dict[str, int]:
    # Imported lazily so this module stays usable without the heavy coach stack.
    from .coach import DIMENSIONS

    return dict(DIMENSIONS)


def load_eval_set() -> dict:
    data = json.loads(EVAL_SET_PATH.read_text(encoding="utf-8"))
    if not (data.get("answers")):
        raise ValueError("eval set has no answers")
    return data


# --------------------------------------------------- independent judge model
#
# A deliberately *different* model scores the same answers, so the agreement
# number is between two systems, not a model compared with itself. The default
# is a local Ollama model, which also demonstrates the on-device path.


def judge_system_prompt() -> str:
    dims = _dimensions()
    lines = "\n".join(f"- {k}: 0-{v}" for k, v in dims.items())
    return (
        "You are an independent hiring assessor. Score the candidate's spoken "
        "answer on each dimension below, using the stated maximum. Judge the "
        "WORDS ONLY; never infer emotion, accent or confidence.\n"
        f"Dimensions:\n{lines}\n"
        "Return ONLY JSON: {\"breakdown\": {"
        + ", ".join(f'"{k}": 0' for k in dims)
        + "}, \"score\": 0}\n"
        "The total score must equal the sum of the dimensions."
    )


def _parse_json(raw: str) -> dict:
    import re

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


def judge_scores(question: str, answer: str, model: str) -> dict:
    """Score one answer with an independent local model. Never touches Aria."""
    from . import brain

    dims = _dimensions()
    user = f"QUESTION: {question}\n\nCANDIDATE ANSWER:\n{answer}"
    raw = brain._ollama_chat(
        [
            {"role": "system", "content": judge_system_prompt()},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        json_mode=True,
        model=model,
    )
    data = _parse_json(raw)
    raw_breakdown = data.get("breakdown") or {}
    breakdown = {
        key: max(0, min(maximum, int(raw_breakdown.get(key, 0) or 0)))
        for key, maximum in dims.items()
    }
    return {"breakdown": breakdown, "score": sum(breakdown.values())}


# -------------------------------------------------------------- aggregations


def _means(runs: list[dict]) -> dict[int, dict]:
    """Mean score and per-dimension mean for each answer from a set of runs."""
    grouped: dict[int, list[dict]] = {}
    for run in runs:
        grouped.setdefault(int(run["answer_id"]), []).append(run)
    dims = _dimensions()
    out: dict[int, dict] = {}
    for aid, items in grouped.items():
        out[aid] = {
            "score": sum(float(i["score"]) for i in items) / len(items),
            "breakdown": {
                key: sum(float(i["breakdown"].get(key, 0) or 0) for i in items)
                / len(items)
                for key in dims
            },
            "runs": len(items),
        }
    return out


def reliability(runs: list[dict]) -> dict:
    """Aria against itself: how much does the same answer move across runs?"""
    grouped: dict[int, list[dict]] = {}
    for run in runs:
        grouped.setdefault(int(run["answer_id"]), []).append(run)
    dims = _dimensions()
    per_answer = []
    dim_sds: dict[str, list[float]] = {key: [] for key in dims}
    for aid, items in sorted(grouped.items()):
        totals = [float(i["score"]) for i in items]
        if len(totals) < 2:
            continue
        total_spread = stats.spread(totals)
        for key in dims:
            values = [float(i["breakdown"].get(key, 0) or 0) for i in items]
            dim_sds[key].append(stats.spread(values)["sd"])
        per_answer.append({"answer_id": aid, **total_spread})
    mean_sd = (
        sum(p["sd"] for p in per_answer) / len(per_answer) if per_answer else None
    )
    mean_range = (
        sum(p["range"] for p in per_answer) / len(per_answer)
        if per_answer
        else None
    )
    return {
        "answers_with_repeated_runs": len(per_answer),
        "mean_sd": mean_sd,
        "mean_range": mean_range,
        "max_range": max((p["range"] for p in per_answer), default=None),
        "per_dimension_sd": {
            key: (sum(v) / len(v) if v else None) for key, v in dim_sds.items()
        },
        "per_answer": per_answer,
    }


def _verdict(rho: float, expected: str, n: int, discriminative: bool) -> str:
    if n < 6 or rho is None or (isinstance(rho, float) and math.isnan(rho)):
        return "not enough data"
    if not discriminative:
        # the proxy cannot separate the benchmark at all, so a correlation
        # against it says nothing about Aria. Reporting "contradicted" here
        # would blame the scorer for a broken yardstick.
        return "proxy not discriminative"
    directed = rho if expected == "+" else -rho
    if directed >= 0.6:
        return "supported"
    if directed >= 0.3:
        return "weakly supported"
    if directed < 0:
        return "contradicted"
    return "not supported"


def discrimination(aria_runs: list[dict]) -> dict:
    """Can Aria tell the benchmark's weak answers from its strong ones?

    The benchmark is built with a known split: each of the 12 questions has one
    deliberately vague answer and one deliberately strong one. Separating them
    is the headline validity claim, reported as AUC (P(a strong answer outranks
    a weak one)) rather than a correlation.
    """
    means = _means(aria_runs)
    answers = load_eval_set()["answers"]

    def scores(quality: str, key: str | None = None) -> list[float]:
        out = []
        for a in answers:
            aid = int(a["id"])
            if a.get("quality") != quality or aid not in means:
                continue
            out.append(
                means[aid]["score"] if key is None else means[aid]["breakdown"][key]
            )
        return out

    strong, weak = scores("strong"), scores("weak")
    per_dimension = []
    for dimension in _dimensions():
        s, w = scores("strong", dimension), scores("weak", dimension)
        value = stats.auc(s, w)
        per_dimension.append(
            {
                "key": dimension,
                "max": _dimensions()[dimension],
                "auc": None if math.isnan(value) else round(value, 3),
                "interpretation": stats.interpret_auc(value),
            }
        )
    total = stats.auc(strong, weak)
    return {
        "n_strong": len(strong),
        "n_weak": len(weak),
        "mean_strong": (sum(strong) / len(strong)) if strong else None,
        "mean_weak": (sum(weak) / len(weak)) if weak else None,
        "min_strong": min(strong) if strong else None,
        "max_weak": max(weak) if weak else None,
        "auc": None if math.isnan(total) else round(total, 3),
        "interpretation": stats.interpret_auc(total),
        "complete_separation": bool(strong and weak and min(strong) > max(weak)),
        "weak_at_or_above_best_strong": (
            sum(1 for w in weak if w >= min(strong)) if strong and weak else 0
        ),
        "per_dimension": per_dimension,
    }


def convergent(aria_runs: list[dict]) -> list[dict]:
    """Objective text features vs Aria's dimension means (Spearman).

    A correlation is only meaningful if the proxy feature can actually tell the
    benchmark's weak answers from its strong ones. Each feature is therefore
    checked for discriminativeness first; a feature that cannot separate the
    benchmark is reported as such instead of being used to indict the scorer.
    """
    means = _means(aria_runs)
    answers = load_eval_set()["answers"]
    by_id = {int(a["id"]): a for a in answers}
    feats = {aid: feature_lib.extract(a["answer"]) for aid, a in by_id.items()}
    strong = [aid for aid, a in by_id.items() if a.get("quality") == "strong" and aid in means]
    weak = [aid for aid, a in by_id.items() if a.get("quality") == "weak" and aid in means]

    results = []
    for hypothesis in feature_lib.HYPOTHESES:
        feature = hypothesis["feature"]
        dimension = hypothesis["dimension"]
        pairs = [
            (feats[aid][feature], means[aid]["breakdown"][dimension])
            for aid in means
            if aid in feats
        ]
        rho = stats.spearman_rho([p[0] for p in pairs], [p[1] for p in pairs])
        proxy_auc = stats.auc(
            [feats[aid][feature] for aid in strong],
            [feats[aid][feature] for aid in weak],
        )
        discriminative = (not math.isnan(proxy_auc)) and abs(proxy_auc - 0.5) >= 0.2
        results.append(
            {
                "dimension": dimension,
                "feature": feature,
                "feature_label": feature_lib.FEATURE_LABELS.get(feature, feature),
                "expected": hypothesis["expected"],
                "label": hypothesis["label"],
                "rho": None if (rho is None or math.isnan(rho)) else round(rho, 3),
                "proxy_auc": None if math.isnan(proxy_auc) else round(proxy_auc, 3),
                "proxy_discriminative": discriminative,
                "n": len(pairs),
                "verdict": _verdict(rho, hypothesis["expected"], len(pairs), discriminative),
            }
        )
    return results


def agreement(aria_runs: list[dict], judge_runs: list[dict]) -> dict | None:
    """Weighted kappa / alpha between Aria's means and an independent judge."""
    if not judge_runs:
        return None
    aria = _means(aria_runs)
    judge = _means(judge_runs)
    ids = sorted(set(aria) & set(judge))
    if not ids:
        return None
    dims = _dimensions()

    dimensions = []
    for key, maximum in dims.items():
        xs = [round(aria[aid]["breakdown"][key]) for aid in ids]
        ys = [round(judge[aid]["breakdown"][key]) for aid in ids]
        dimensions.append(
            {
                "key": key,
                "max": maximum,
                "kappa": stats.weighted_cohen_kappa(xs, ys, max_value=maximum),
                "alpha": stats.krippendorff_alpha(
                    [[float(a), float(b)] for a, b in zip(xs, ys)], "ordinal"
                ),
                "mae": stats.mean_absolute_error(xs, ys),
                "interpretation": stats.interpret_kappa(
                    stats.weighted_cohen_kappa(xs, ys, max_value=maximum)
                ),
            }
        )

    aria_totals = [round(sum(aria[aid]["breakdown"].values())) for aid in ids]
    judge_totals = [round(sum(judge[aid]["breakdown"].values())) for aid in ids]
    overall_kappa = stats.weighted_cohen_kappa(aria_totals, judge_totals, max_value=100)
    overall = {
        "key": "overall",
        "max": 100,
        "kappa": overall_kappa,
        "alpha": stats.krippendorff_alpha(
            [[float(a), float(b)] for a, b in zip(aria_totals, judge_totals)],
            "ordinal",
        ),
        "mae": stats.mean_absolute_error(aria_totals, judge_totals),
        # how much harsher the judge is overall; kappa is depressed by a purely
        # systematic severity difference, so this is reported next to it
        "mean_level_delta": (
            sum(judge_totals) / len(judge_totals)
            - sum(aria_totals) / len(aria_totals)
            if judge_totals
            else None
        ),
        "interpretation": stats.interpret_kappa(overall_kappa),
    }
    return {
        "answers": len(ids),
        "dimensions": dimensions,
        "overall": overall,
    }


# ------------------------------------------------------------------- report


def build_report() -> dict:
    dims = _dimensions()
    aria_runs = store.aria_runs(source="aria")
    sources = [s for s in store.eval_sources() if s != "aria"]
    judge_source = sources[0] if sources else None
    judge_runs = store.aria_runs(source=judge_source) if judge_source else []

    eval_set = load_eval_set()
    total_answers = len(eval_set["answers"])
    rel = reliability(aria_runs)
    enough = rel["answers_with_repeated_runs"] >= total_answers * 0.8

    engines = sorted({r.get("engine", "") for r in aria_runs if r.get("engine")})
    report = {
        "version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ready": bool(enough),
        "eval_set": {"answers": total_answers, "path": str(EVAL_SET_PATH)},
        "aria": {
            "engine": engines[0] if engines else None,
            "runs_total": len(aria_runs),
            "runs_per_answer": {
                "min": min((v["runs"] for v in _means(aria_runs).values()), default=0),
                "max": max((v["runs"] for v in _means(aria_runs).values()), default=0),
            },
        },
        "reliability": rel,
        "discrimination": discrimination(aria_runs),
        "convergent": convergent(aria_runs),
        "independent_judge": (
            {"model": judge_source, **(agreement(aria_runs, judge_runs) or {})}
            if judge_source
            else None
        ),
        "caveats": [
            "No human ratings: the candidate using Aria is never asked to grade it, "
            "and the team carries no manual rating chore.",
            "Reliability is Aria against itself across repeated runs of identical text.",
            "Discrimination is against the benchmark's own designed weak/strong split, "
            "not against an external ground truth.",
            "A proxy feature that cannot separate weak from strong answers is reported as "
            "'not discriminative' rather than being used to score Aria.",
            "An independent judge model is not ground truth; a small local model is much "
            "harsher, which depresses kappa without meaning the ordering disagrees.",
            "Spaced practice is supported, but transfer to a real interview is weaker "
            "than advertised (Latimier 2021; Corral 2025) - Aria does not predict hires.",
        ],
        "dimensions": dims,
    }
    return report


def write_report(report: dict | None = None) -> dict:
    report = report or build_report()
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def load_report() -> dict | None:
    try:
        return json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
