"""Mean reversion features: z-score of log ratio."""

from __future__ import annotations

import math

import numpy as np


def compute_zscore(closes: list[float], window: int = 24) -> float | None:
    """Compute z-score of current log_ratio vs rolling window.

    Uses the last `window` bars to compute mean and std of log(close),
    then measures how far the current value deviates.
    """
    if len(closes) < window:
        return None

    log_values = []
    for c in closes:
        if c > 0:
            log_values.append(math.log(c))
        else:
            log_values.append(0.0)

    if len(log_values) < window:
        return None

    window_data = np.array(log_values[-window:])
    current = log_values[-1]
    mean = float(np.mean(window_data))
    std = float(np.std(window_data, ddof=1))

    if std < 1e-12:
        return 0.0

    return (current - mean) / std
