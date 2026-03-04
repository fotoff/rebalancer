"""Regime classifier v2: based on price divergence patterns."""

from __future__ import annotations

from src.models.features import FeatureVector
from src.models.recommendation import Regime

# Thresholds
DIVERGENCE_STRONG = 5.0      # 5% divergence = strong signal
DIVERGENCE_MODERATE = 2.0    # 2% divergence = moderate
TREND_THRESHOLD = 8.0        # 8% 7d trend = strong trend


def classify_regime(features: FeatureVector) -> Regime:
    """Classify market regime based on price divergence patterns.

    MEAN_REVERSION: tokens diverged significantly, expect convergence
    TREND: both tokens trending, or one token trending strongly
    NEUTRAL: no significant divergence or trend
    """
    div_24h = features.divergence_24h
    div_7d = features.divergence_7d
    abs_max = features.abs_divergence_max

    if abs_max is None or abs_max < DIVERGENCE_MODERATE:
        return Regime.NEUTRAL

    # Check if divergence is consistent across timeframes (mean reversion setup)
    div_short = abs(div_24h) if div_24h is not None else 0
    div_long = abs(div_7d) if div_7d is not None else 0

    # If short-term divergence is high but long-term is even higher
    # → strong trend, tokens are moving apart steadily
    if div_long > TREND_THRESHOLD and div_short < div_long * 0.3:
        return Regime.TREND

    # If short-term divergence is high → mean reversion opportunity
    if div_short >= DIVERGENCE_STRONG:
        return Regime.MEAN_REVERSION

    # If medium-term divergence with consistent direction
    if abs_max >= DIVERGENCE_MODERATE:
        # Check z-score for extra confidence
        z = features.zscore_ratio_7d
        if z is not None and abs(z) >= 1.5:
            return Regime.MEAN_REVERSION
        return Regime.TREND if div_long > DIVERGENCE_STRONG else Regime.NEUTRAL

    return Regime.NEUTRAL
