"""Momentum features: returns on different horizons."""

from __future__ import annotations

import math


def _return_over_n(closes: list[float], n: int) -> float | None:
    """Compute simple return over last n bars: (last - n_ago) / n_ago."""
    if len(closes) < n + 1:
        return None
    current = closes[-1]
    past = closes[-(n + 1)]
    if past <= 0:
        return None
    return (current - past) / past


def _log_return_over_n(closes: list[float], n: int) -> float | None:
    if len(closes) < n + 1:
        return None
    current = closes[-1]
    past = closes[-(n + 1)]
    if past <= 0 or current <= 0:
        return None
    return math.log(current / past)


def compute_momentum(
    closes_a: list[float],
    closes_b: list[float],
    closes_ratio: list[float],
) -> dict:
    """Compute returns for tokens A, B, and ratio on 1h/4h/1d horizons.

    Assumes daily bars — so 1h ≈ last bar delta, 4h ≈ 1 bar back, 1d = 1 bar back.
    With daily candles: 1h and 4h approximate to 1-bar return, 1d = 1 bar.
    With hourly candles: 1h=1, 4h=4, 1d=24.
    """
    # For daily bars, use conservative mapping: 1h→1bar, 4h→1bar, 1d→1bar
    horizons = {"1h": 1, "4h": 1, "1d": 1}

    result: dict[str, float | None] = {}

    for label, n in horizons.items():
        result[f"return_ratio_{label}"] = _return_over_n(closes_ratio, n)
        result[f"return_a_{label}"] = _return_over_n(closes_a, n)
        result[f"return_b_{label}"] = _return_over_n(closes_b, n)

    return result
