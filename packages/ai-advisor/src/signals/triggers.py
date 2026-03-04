"""Trigger suggestion generator v2: based on price divergence."""

from __future__ import annotations

from src.models.features import FeatureVector
from src.models.recommendation import Regime, TriggerSuggestion, TriggerType


def suggest_triggers(
    features: FeatureVector,
    regime: Regime,
    rebalance_pct: float,
    symbol_a: str = "A",
    symbol_b: str = "B",
) -> list[TriggerSuggestion]:
    """Generate trigger suggestions based on divergence and regime."""
    if regime == Regime.MEAN_REVERSION:
        return _mean_reversion_triggers(features, rebalance_pct, symbol_a, symbol_b)
    elif regime == Regime.TREND:
        return _trend_triggers(features, rebalance_pct, symbol_a, symbol_b)
    return []


def _mean_reversion_triggers(
    features: FeatureVector,
    rebalance_pct: float,
    symbol_a: str,
    symbol_b: str,
) -> list[TriggerSuggestion]:
    """RATIO_BAND: set bands around current ratio based on divergence magnitude."""
    ratio = features.ratio
    if ratio <= 0:
        return []

    # Band width proportional to the divergence we observed
    abs_div = features.abs_divergence_max or 3.0
    band_pct = max(0.02, abs_div / 100 * 0.8)

    upper = ratio * (1 + band_pct)
    lower = ratio * (1 - band_pct)

    return [
        TriggerSuggestion(
            type=TriggerType.RATIO_BAND,
            direction="1to2",
            metric="ratio",
            trigger_type="gte",
            value=round(upper, 6),
            rebalance_pct=rebalance_pct,
            label=f"Sell {symbol_a} when ratio >= {upper:.4f} ({symbol_a} +{band_pct:.1%})",
        ),
        TriggerSuggestion(
            type=TriggerType.RATIO_BAND,
            direction="2to1",
            metric="ratio",
            trigger_type="lte",
            value=round(lower, 6),
            rebalance_pct=rebalance_pct,
            label=f"Sell {symbol_b} when ratio <= {lower:.4f} ({symbol_b} +{band_pct:.1%})",
        ),
    ]


def _trend_triggers(
    features: FeatureVector,
    rebalance_pct: float,
    symbol_a: str,
    symbol_b: str,
) -> list[TriggerSuggestion]:
    """TREND_GUARDED_BAND: wider band in trend direction, tighter stop."""
    ratio = features.ratio
    if ratio <= 0:
        return []

    abs_div = features.abs_divergence_max or 5.0
    base_band = max(0.03, abs_div / 100)

    # Trend direction from outperformer
    trending_a_up = features.outperformer == "A"

    wide_band = base_band * 1.5
    tight_band = base_band * 0.6

    if trending_a_up:
        upper = ratio * (1 + wide_band)
        lower = ratio * (1 - tight_band)
    else:
        upper = ratio * (1 + tight_band)
        lower = ratio * (1 - wide_band)

    half_pct = max(5.0, rebalance_pct * 0.5)

    return [
        TriggerSuggestion(
            type=TriggerType.TREND_GUARDED_BAND,
            direction="1to2",
            metric="ratio",
            trigger_type="gte",
            value=round(upper, 6),
            rebalance_pct=half_pct,
            label=f"Trend: sell {symbol_a} at ratio >= {upper:.4f}",
        ),
        TriggerSuggestion(
            type=TriggerType.TREND_GUARDED_BAND,
            direction="2to1",
            metric="ratio",
            trigger_type="lte",
            value=round(lower, 6),
            rebalance_pct=half_pct,
            label=f"Trend: sell {symbol_b} at ratio <= {lower:.4f}",
        ),
    ]
