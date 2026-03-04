"""Signal engine v2: divergence-based action determination."""

from __future__ import annotations

import structlog

from src.models.features import FeatureVector
from src.models.recommendation import (
    Action,
    ReasonFactor,
    Regime,
    TriggerSuggestion,
)
from src.models.request import UserConstraints
from src.signals.regime import classify_regime
from src.signals.sizing import compute_rebalance_pct
from src.signals.triggers import suggest_triggers

logger = structlog.get_logger()

# Thresholds for action decisions
DIVERGENCE_REBALANCE_NOW = 8.0   # 8%+ divergence → immediate rebalance
DIVERGENCE_SUGGEST = 3.0         # 3%+ divergence → suggest triggers
MIN_EDGE_FOR_ACTION = 5.0        # minimum edge in bps after cost


class SignalResult:
    __slots__ = (
        "action", "regime", "expected_edge_bps", "cost_bps", "p_win",
        "rebalance_pct", "sell_direction", "reasons", "triggers",
    )

    def __init__(self) -> None:
        self.action = Action.HOLD
        self.regime = Regime.NEUTRAL
        self.expected_edge_bps = 0.0
        self.cost_bps = 0.0
        self.p_win = 0.5
        self.rebalance_pct = 0.0
        self.sell_direction = ""
        self.reasons: list[ReasonFactor] = []
        self.triggers: list[TriggerSuggestion] = []


def compute_signal(
    features: FeatureVector,
    constraints: UserConstraints | None = None,
    symbol_a: str = "",
    symbol_b: str = "",
) -> SignalResult:
    """Main signal computation based on price divergence."""
    result = SignalResult()
    constraints = constraints or UserConstraints()

    regime = classify_regime(features)
    result.regime = regime

    # Best available divergence signal (prefer 24h, fallback 6h, 1h)
    div = _best_divergence(features)
    abs_div = abs(div) if div is not None else 0.0
    cost = features.cost_bps or 0.0
    result.cost_bps = cost

    # --- Expected edge ---
    # Edge proportional to divergence: 1% divergence ≈ 100 bps potential
    # Discount by cost and a conservative factor
    raw_edge_bps = abs_div * 100 * 0.3  # 30% capture rate assumption
    result.expected_edge_bps = round(raw_edge_bps - cost, 2)

    # --- pWin estimate ---
    if abs_div >= 10.0:
        p_win = 0.72
    elif abs_div >= 5.0:
        p_win = 0.63
    elif abs_div >= 3.0:
        p_win = 0.55
    else:
        p_win = 0.48

    # Social modifier: negative sentiment on the outperformer reduces confidence
    if features.social_divergence is not None:
        if features.outperformer == "A" and features.sentiment_a is not None:
            if features.sentiment_a < -0.3:
                p_win *= 0.92
        elif features.outperformer == "B" and features.sentiment_b is not None:
            if features.sentiment_b < -0.3:
                p_win *= 0.92

    # Adjust for cost impact
    if cost > 0 and raw_edge_bps > 0:
        cost_ratio = cost / raw_edge_bps
        if cost_ratio > 0.5:
            p_win *= 0.9

    result.p_win = round(p_win, 3)

    # --- Direction ---
    # If div > 0, A outperformed → sell A, buy B (1to2)
    # If div < 0, B outperformed → sell B, buy A (2to1)
    if div is not None and div > 0:
        result.sell_direction = "1to2"
    else:
        result.sell_direction = "2to1"

    # --- Sizing ---
    # Use divergence magnitude instead of z-score for sizing
    normalized_strength = abs_div / 5.0  # normalize: 5% div = 1.0 strength
    result.rebalance_pct = compute_rebalance_pct(
        normalized_strength, constraints.max_trade_pct
    )

    # --- Build reasons ---
    _add_reasons(result, features, div, abs_div, cost, regime, symbol_a, symbol_b)

    # --- Determine action ---
    if regime == Regime.NEUTRAL or result.expected_edge_bps < MIN_EDGE_FOR_ACTION:
        result.action = Action.HOLD
    elif abs_div >= DIVERGENCE_REBALANCE_NOW and result.expected_edge_bps >= MIN_EDGE_FOR_ACTION * 2:
        result.action = Action.REBALANCE_NOW
    elif abs_div >= DIVERGENCE_SUGGEST:
        result.action = Action.SUGGEST_TRIGGERS
    else:
        result.action = Action.HOLD

    # Generate trigger suggestions
    if result.action in (Action.SUGGEST_TRIGGERS, Action.REBALANCE_NOW):
        result.triggers = suggest_triggers(
            features, regime, result.rebalance_pct, symbol_a, symbol_b
        )

    logger.info(
        "signal_computed",
        action=result.action.value,
        regime=regime.value,
        divergence_24h=div,
        abs_div_max=features.abs_divergence_max,
        edge_bps=result.expected_edge_bps,
        p_win=result.p_win,
        outperformer=features.outperformer,
    )

    return result


def _best_divergence(features: FeatureVector) -> float | None:
    """Pick the best available divergence signal."""
    if features.divergence_24h is not None:
        return features.divergence_24h
    if features.divergence_6h is not None:
        return features.divergence_6h
    return features.divergence_1h


def _add_reasons(
    result: SignalResult,
    features: FeatureVector,
    div: float | None,
    abs_div: float,
    cost: float,
    regime: Regime,
    sym_a: str,
    sym_b: str,
) -> None:
    """Build reasons list explaining the signal."""
    if features.price_change_a_24h is not None:
        result.reasons.append(ReasonFactor(
            code="PRICE_CHANGE_A",
            label=f"{sym_a} Price 24h",
            value=round(features.price_change_a_24h, 2),
            detail=f"{sym_a}: {features.price_change_a_24h:+.2f}% in 24h",
        ))
    if features.price_change_b_24h is not None:
        result.reasons.append(ReasonFactor(
            code="PRICE_CHANGE_B",
            label=f"{sym_b} Price 24h",
            value=round(features.price_change_b_24h, 2),
            detail=f"{sym_b}: {features.price_change_b_24h:+.2f}% in 24h",
        ))

    if div is not None:
        outperf = sym_a if div > 0 else sym_b
        result.reasons.append(ReasonFactor(
            code="DIVERGENCE_24H",
            label="Divergence 24h",
            value=round(div, 2),
            detail=f"Price divergence: {abs_div:.1f}%, {outperf} leads",
        ))

    if features.divergence_7d is not None:
        result.reasons.append(ReasonFactor(
            code="DIVERGENCE_7D",
            label="Divergence 7d",
            value=round(features.divergence_7d, 2),
            detail=f"7-day divergence: {abs(features.divergence_7d):.1f}%",
        ))

    if features.volatility_a_7d is not None:
        if features.volatility_b_7d is not None:
            vol_detail = f"{sym_a}: {features.volatility_a_7d:.1%} / {sym_b}: {features.volatility_b_7d:.1%}"
        else:
            vol_detail = f"{sym_a}: {features.volatility_a_7d:.1%}"
        result.reasons.append(ReasonFactor(
            code="VOLATILITY",
            label="Volatility",
            value=round(features.volatility_a_7d, 4),
            detail=vol_detail,
        ))

    if features.social_divergence is not None and features.sentiment_a is not None and features.sentiment_b is not None:
        result.reasons.append(ReasonFactor(
            code="SOCIAL",
            label="Social Sentiment",
            value=round(features.social_divergence, 3),
            detail=f"Sentiment {sym_a}={features.sentiment_a:.2f}, {sym_b}={features.sentiment_b:.2f}",
        ))

    if cost > 0:
        result.reasons.append(ReasonFactor(
            code="TOTAL_COST",
            label="Trade cost",
            value=round(cost, 2),
            detail=f"Slippage + gas: {cost:.1f} bps",
        ))

    result.reasons.append(ReasonFactor(
        code="REGIME",
        label="Market regime",
        value=0,
        detail=regime.value,
    ))
