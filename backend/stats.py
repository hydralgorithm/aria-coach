"""Inter-rater agreement statistics for Aria's published error bars.

Pure-NumPy implementations written from the definitions so the maths is
auditable and unit-testable. scipy / sklearn / pandas are not dependencies of
this project, and adding them for a handful of coefficients would not survive a
judge asking "why".

Published coefficients (docs/HACKATHON-PLAN.md, step 8):

* **weighted Cohen's kappa** — exactly two raters, linear or quadratic
  disagreement weights over an ordinal scale.
* **Krippendorff's alpha** — any number of raters, missing values allowed,
  nominal or ordinal metric.
* **mean absolute error** and **intra-rater spread** — reported in the answer's
  own units, next to the kappa/alpha, because a coefficient alone hides the
  magnitude of the disagreement.

The two implementations are cross-checked against each other in the test run:
alpha is computed once from the coincidence matrix and once from the direct
pairwise definition, and the two must match.
"""

from __future__ import annotations

import math

import numpy as np


def _as_float(values) -> np.ndarray:
    return np.asarray(list(values), dtype=float)


def _present(values) -> np.ndarray:
    arr = _as_float(values)
    return arr[~np.isnan(arr)]


def _paired(a, b) -> tuple[np.ndarray, np.ndarray]:
    a = _as_float(a)
    b = _as_float(b)
    if a.shape != b.shape:
        raise ValueError("a and b must have the same shape")
    mask = ~(np.isnan(a) | np.isnan(b))
    return a[mask], b[mask]


# --------------------------------------------------------- weighted Cohen's kappa


def weighted_cohen_kappa(
    a, b, max_value: int | None = None, weights: str = "linear"
) -> float:
    """Weighted Cohen's kappa for two raters on an ordinal scale.

    ``weights='linear'`` uses ``|i-j| / (k-1)``; ``'quadratic'`` squares it.
    Only rows where both raters gave a value are used. Returns ``nan`` when
    there is nothing to compare.
    """
    a, b = _paired(a, b)
    if a.size == 0:
        return float("nan")
    if max_value is None:
        max_value = int(max(a.max(), b.max()))
    size = int(max_value) + 1
    observed = np.zeros((size, size), dtype=float)
    for x, y in zip(a.astype(int), b.astype(int)):
        observed[x, y] += 1.0
    n = observed.sum()
    expected = np.outer(observed.sum(axis=1), observed.sum(axis=0)) / n
    idx = np.arange(size)
    linear = np.abs(idx[:, None] - idx[None, :]) / max(1, size - 1)
    w = linear if weights == "linear" else linear ** 2
    observed_disagreement = float((w * observed).sum())
    expected_disagreement = float((w * expected).sum())
    if expected_disagreement == 0:
        # every rating identical: perfect agreement by definition
        return 1.0 if observed_disagreement == 0 else float("nan")
    return 1.0 - observed_disagreement / expected_disagreement


# ------------------------------------------------------- Krippendorff's alpha


def _coincidence(units, index, size):
    o = np.zeros((size, size), dtype=float)
    for unit in units:
        m = len(unit)
        idxs = [index[v] for v in unit]
        for i in idxs:
            for j in idxs:
                if i != j:
                    o[i, j] += 1.0 / (m - 1)
    return o


def _ordinal_distances(categories, counts):
    """Krippendorff's ordinal metric: δ²_ck = (Σ_{g=c..k} n_g − (n_c+n_k)/2)²."""
    v = len(categories)
    cumulative = np.cumsum(counts)
    delta2 = np.zeros((v, v), dtype=float)
    for c in range(v):
        for k in range(c, v):
            span = cumulative[k] - (cumulative[c - 1] if c > 0 else 0.0)
            value = span - (counts[c] + counts[k]) / 2.0
            delta2[c, k] = delta2[k, c] = value ** 2
    return delta2


def _metric(categories, counts, level: str):
    v = len(categories)
    if level == "nominal":
        return np.ones((v, v)) - np.eye(v)
    if level == "interval":
        diff = np.abs(categories[:, None] - categories[None, :])
        return diff ** 2
    if level == "ordinal":
        return _ordinal_distances(categories, counts)
    raise ValueError(f"unknown level_of_measurement '{level}'")


def _prepare(data):
    units = []
    for raw in data:
        arr = _present(raw)
        if arr.size >= 2:
            units.append(arr.tolist())
    if not units:
        return units, np.array([]), {}, np.array([])
    values = sorted({v for unit in units for v in unit})
    categories = np.asarray(values, dtype=float)
    index = {v: i for i, v in enumerate(values)}
    counts = np.zeros(len(values), dtype=float)
    for unit in units:
        for v in unit:
            counts[index[v]] += 1.0
    return units, categories, index, counts


def krippendorff_alpha(data, level: str = "ordinal") -> float:
    """Krippendorff's alpha via the coincidence matrix.

    ``data`` is a list of units; each unit is a sequence of rater values, with
    ``None``/``nan`` for a rater who did not rate that unit.
    """
    units, categories, index, counts = _prepare(data)
    if not units:
        return float("nan")
    size = len(categories)
    o = _coincidence(units, index, size)
    n = counts.sum()
    observed = float((o * _metric(categories, counts, level)).sum())
    expected = np.outer(counts, counts) / (n - 1)
    np.fill_diagonal(expected, counts * (counts - 1) / (n - 1))
    expected_disagreement = float((expected * _metric(categories, counts, level)).sum())
    if expected_disagreement == 0:
        return 1.0 if observed == 0 else float("nan")
    return 1.0 - observed / expected_disagreement


def krippendorff_alpha_direct(data, level: str = "ordinal") -> float:
    """Alpha from the direct pairwise definition (independent cross-check).

    Same result as :func:`krippendorff_alpha`; kept so the test run can prove
    the coincidence-matrix construction is not the source of a wrong answer.
    """
    units, categories, index, counts = _prepare(data)
    if not units:
        return float("nan")
    metric = _metric(categories, counts, level)
    n = counts.sum()
    observed = 0.0
    for unit in units:
        m = len(unit)
        idxs = [index[v] for v in unit]
        total = 0.0
        for i in range(m):
            for j in range(i + 1, m):
                total += metric[idxs[i], idxs[j]]
        pairs = m * (m - 1) / 2.0
        observed += m * (total / pairs)
    observed /= n
    p = np.outer(counts, counts)
    np.fill_diagonal(p, counts * (counts - 1))
    expected = float((metric * p).sum()) / (n * (n - 1))
    if expected == 0:
        return 1.0 if observed == 0 else float("nan")
    return 1.0 - observed / expected


# ---------------------------------------------------------- magnitude measures


def mean_absolute_error(predicted, actual) -> float:
    """Mean |predicted − actual| over paired, present values, in scale units."""
    a, b = _paired(predicted, actual)
    if a.size == 0:
        return float("nan")
    return float(np.mean(np.abs(a - b)))


def spread(values) -> dict:
    """Sample SD and range of a set of repeated measurements."""
    arr = _present(values)
    if arr.size == 0:
        return {"n": 0, "mean": float("nan"), "sd": float("nan"), "range": float("nan")}
    sd = float(np.std(arr, ddof=1)) if arr.size > 1 else 0.0
    return {
        "n": int(arr.size),
        "mean": float(np.mean(arr)),
        "sd": sd,
        "range": float(np.max(arr) - np.min(arr)),
    }


def _rankdata(values) -> np.ndarray:
    """Average ranks (1-based), ties share the mean rank."""
    a = np.asarray(values, dtype=float)
    sorter = np.argsort(a, kind="mergesort")
    inv = np.empty(len(a), dtype=int)
    inv[sorter] = np.arange(len(a))
    sorted_a = a[sorter]
    distinct = np.r_[True, sorted_a[1:] != sorted_a[:-1]]
    dense = distinct.cumsum()[inv]
    count = np.r_[np.nonzero(distinct)[0], len(a)]
    return 0.5 * (count[dense] + count[dense - 1] + 1)


def spearman_rho(a, b) -> float:
    """Spearman rank correlation over paired, present values.

    Used to check whether an Aria dimension moves in the expected direction as
    an objective property of the text moves (e.g. more concrete numbers should
    raise the evidence score). Returns ``nan`` when there is too little data or
    no variance to rank.
    """
    x, y = _paired(a, b)
    if x.size < 3:
        return float("nan")
    rx, ry = _rankdata(x), _rankdata(y)
    if np.all(rx == rx[0]) or np.all(ry == ry[0]):
        return float("nan")
    rx = rx - rx.mean()
    ry = ry - ry.mean()
    denom = math.sqrt(float((rx ** 2).sum()) * float((ry ** 2).sum()))
    if denom == 0:
        return float("nan")
    return float((rx * ry).sum() / denom)


def auc(high, low) -> float:
    """Area under the ROC curve, i.e. P(a random `high` beats a random `low`).

    Ties count a half. 0.5 means the two groups are indistinguishable, 1.0
    means perfect separation. Used to test whether an instrument can tell the
    benchmark's weak answers from its strong ones, and whether a proxy feature
    discriminates at all before it is trusted for a correlation.
    """
    high = _present(high)
    low = _present(low)
    if high.size == 0 or low.size == 0:
        return float("nan")
    wins = ties = 0
    for h in high:
        for l in low:
            if h > l:
                wins += 1
            elif h == l:
                ties += 1
    return (wins + 0.5 * ties) / (high.size * low.size)


def interpret_auc(value: float) -> str:
    if value is None or math.isnan(value):
        return "not enough data"
    if value >= 0.9:
        return "near-perfect separation"
    if value >= 0.8:
        return "strong separation"
    if value >= 0.7:
        return "acceptable separation"
    if value >= 0.6:
        return "weak separation"
    if value >= 0.55:
        return "poor separation"
    return "indistinguishable"


def interpret_kappa(value: float) -> str:
    """Landis & Koch verbal bands, used verbatim in the UI."""
    if value is None or math.isnan(value):
        return "not enough data"
    if value < 0:
        return "worse than chance"
    if value < 0.20:
        return "slight"
    if value < 0.40:
        return "fair"
    if value < 0.60:
        return "moderate"
    if value < 0.80:
        return "substantial"
    return "almost perfect"
