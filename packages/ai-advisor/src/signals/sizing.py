"""Trade sizing: how much to rebalance based on signal strength and constraints."""

from __future__ import annotations


# Sizing parameters (MVP)
K_SIZING = 10.0  # base multiplier: rebalance_pct = K * |z|
MIN_REBALANCE_PCT = 5.0
MAX_REBALANCE_PCT = 50.0


def compute_rebalance_pct(
    abs_zscore: float,
    max_trade_pct: float | None = None,
) -> float:
    """Compute rebalance percentage as a function of |zscore|.

    rebalance_pct = clamp(K * |z|, min_pct, max_pct)
    Respects user constraint max_trade_pct if provided.
    """
    upper = MAX_REBALANCE_PCT
    if max_trade_pct is not None and max_trade_pct > 0:
        upper = min(upper, max_trade_pct)

    raw_pct = K_SIZING * abs_zscore
    return max(MIN_REBALANCE_PCT, min(raw_pct, upper))


def compute_sell_amount(
    rebalance_pct: float,
    vault_balance: float,
) -> float:
    """Compute the amount to sell in human-readable units."""
    if vault_balance <= 0 or rebalance_pct <= 0:
        return 0.0
    return vault_balance * (rebalance_pct / 100.0)
