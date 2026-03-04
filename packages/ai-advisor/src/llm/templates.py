"""Fallback template explanations v2: divergence-based, English."""

from __future__ import annotations

from src.models.features import FeatureVector
from src.models.recommendation import (
    Action,
    Explanation,
    PolicyResult,
    Regime,
)


def build_template_explanation(
    action: Action,
    regime: Regime,
    features: FeatureVector,
    policy: PolicyResult,
    expected_edge_bps: float,
    cost_bps: float,
    symbol_a: str = "A",
    symbol_b: str = "B",
) -> Explanation:
    """Generate structured explanation from templates."""
    short = _build_short(action, regime, features, expected_edge_bps, cost_bps, symbol_a, symbol_b)
    details = _build_details(
        action, regime, features, policy, expected_edge_bps, cost_bps, symbol_a, symbol_b
    )
    return Explanation(short=short, details=details)


def _build_short(
    action: Action,
    regime: Regime,
    f: FeatureVector,
    edge_bps: float,
    cost_bps: float,
    sym_a: str,
    sym_b: str,
) -> str:
    div = f.divergence_24h
    outperf = sym_a if f.outperformer == "A" else sym_b if f.outperformer == "B" else "—"
    underperf = sym_b if f.outperformer == "A" else sym_a if f.outperformer == "B" else "—"

    if action == Action.HOLD:
        if div is not None and abs(div) < 2:
            return f"{sym_a}/{sym_b}: prices moving in sync, no rebalance needed."
        if edge_bps <= 0:
            return f"Rebalancing {sym_a}/{sym_b} is unprofitable: fees exceed expected edge."
        return f"Not enough price divergence for {sym_a}/{sym_b}. Hold recommended."

    if action == Action.REBALANCE_NOW:
        change = f.price_change_a_24h if f.outperformer == "A" else f.price_change_b_24h
        change_str = f"{change:+.1f}%" if change is not None else "N/A"
        flat = _is_flat(f, f.outperformer)
        return (
            f"{outperf} is up {change_str}, "
            f"while {underperf} {'stayed flat' if flat else 'lagged behind'}. "
            f"Rebalance recommended: sell some {outperf}, buy {underperf} "
            f"(edge {edge_bps:.0f} bps)."
        )

    if action == Action.SUGGEST_TRIGGERS:
        return (
            f"Divergence {sym_a}/{sym_b}: {abs(div or 0):.1f}%. "
            f"Create triggers for automatic rebalancing recommended."
        )

    return f"{sym_a}/{sym_b}: {action.value}"


def _build_details(
    action: Action,
    regime: Regime,
    f: FeatureVector,
    policy: PolicyResult,
    edge_bps: float,
    cost_bps: float,
    sym_a: str,
    sym_b: str,
) -> str:
    lines = []
    lines.append(f"**Pair:** {sym_a}/{sym_b}")
    lines.append(f"**Regime:** {regime.value}")
    lines.append(f"**Action:** {action.value}")

    if f.price_change_a_24h is not None:
        lines.append(f"**{sym_a} 24h:** {f.price_change_a_24h:+.2f}%")
    if f.price_change_b_24h is not None:
        lines.append(f"**{sym_b} 24h:** {f.price_change_b_24h:+.2f}%")

    if f.divergence_24h is not None:
        outperf = sym_a if f.outperformer == "A" else sym_b
        lines.append(f"**Divergence 24h:** {abs(f.divergence_24h):.2f}% ({outperf} leads)")

    if f.divergence_7d is not None:
        lines.append(f"**Divergence 7d:** {abs(f.divergence_7d):.2f}%")

    if f.trend_a_7d is not None and f.trend_b_7d is not None:
        lines.append(f"**7d trend:** {sym_a} {f.trend_a_7d:+.1f}% / {sym_b} {f.trend_b_7d:+.1f}%")

    if f.volatility_a_7d is not None and f.volatility_b_7d is not None:
        lines.append(f"**Volatility 7d:** {sym_a} {f.volatility_a_7d:.1%} / {sym_b} {f.volatility_b_7d:.1%}")
    elif f.volatility_a_7d is not None:
        lines.append(f"**Volatility 7d:** {sym_a} {f.volatility_a_7d:.1%}")

    if f.has_social and f.sentiment_a is not None and f.sentiment_b is not None:
        lines.append(f"**Sentiment:** {sym_a}={f.sentiment_a:+.2f}, {sym_b}={f.sentiment_b:+.2f}")
    elif f.has_social and f.sentiment_a is not None:
        lines.append(f"**Sentiment {sym_a}:** {f.sentiment_a:+.2f}")

    lines.append(f"**Edge after fees:** {edge_bps:.1f} bps")
    if cost_bps > 0:
        lines.append(f"**Fees:** {cost_bps:.1f} bps")

    if not policy.passed:
        block_msgs = [v.message for v in policy.violations if v.severity == "BLOCK"]
        if block_msgs:
            lines.append(f"**Blocked:** {'; '.join(block_msgs)}")

    warns = [v.message for v in policy.violations if v.severity == "WARN"]
    if warns:
        lines.append(f"**Warnings:** {'; '.join(warns)}")

    return "\n".join(lines)


def _is_flat(f: FeatureVector, outperformer: str | None) -> bool:
    """Check if the underperforming token is relatively flat."""
    if outperformer == "A":
        change = f.price_change_b_24h
    else:
        change = f.price_change_a_24h
    return change is not None and abs(change) < 1.5
