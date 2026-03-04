"""Ratio and spread features."""

from __future__ import annotations

import math


def compute_ratio_features(price_a: float, price_b: float) -> dict:
    """Compute ratio = pA/pB and log_ratio = log(pA) - log(pB)."""
    if price_b <= 0 or price_a <= 0:
        return {"ratio": 0.0, "log_ratio": 0.0}

    ratio = price_a / price_b
    log_ratio = math.log(price_a) - math.log(price_b)
    return {"ratio": ratio, "log_ratio": log_ratio}
