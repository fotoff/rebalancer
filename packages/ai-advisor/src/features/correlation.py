"""Correlation features: Pearson correlation of token returns."""

from __future__ import annotations

import math

import numpy as np


def compute_correlation(
    closes_a: list[float], closes_b: list[float], window: int = 24
) -> float | None:
    """Compute Pearson correlation between token A and B log-returns.

    Uses the last `window` bars from each series.
    Returns None if insufficient data.
    """
    min_len = min(len(closes_a), len(closes_b))
    if min_len < 3:
        return None

    # Align from the end (both series may have different lengths)
    a = closes_a[-min_len:]
    b = closes_b[-min_len:]

    returns_a = []
    returns_b = []
    for i in range(1, len(a)):
        if a[i] > 0 and a[i - 1] > 0 and b[i] > 0 and b[i - 1] > 0:
            returns_a.append(math.log(a[i] / a[i - 1]))
            returns_b.append(math.log(b[i] / b[i - 1]))

    if len(returns_a) < 3:
        return None

    # Use last `window` returns
    ra = np.array(returns_a[-window:])
    rb = np.array(returns_b[-window:])

    if np.std(ra) < 1e-12 or np.std(rb) < 1e-12:
        return 0.0

    corr_matrix = np.corrcoef(ra, rb)
    return float(corr_matrix[0, 1])
