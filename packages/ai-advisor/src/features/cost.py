"""Cost and liquidity features derived from quote snapshot."""

from __future__ import annotations

from src.models.snapshot import QuoteSnapshot


def compute_cost_features(
    quote: QuoteSnapshot | None,
    price_a_usd: float = 0,
) -> dict:
    """Compute cost_bps and liquidity_score from quote data.

    cost_bps = slippage_bps + fee_bps + gas_bps
    gas_bps = gas_usd / trade_usd * 10000

    liquidity_score: 0-1 proxy based on slippage.
    Low slippage = high liquidity.
    """
    result: dict[str, float | None] = {
        "cost_bps": None,
        "slippage_bps": None,
        "gas_usd": None,
        "liquidity_score": None,
    }

    if not quote:
        return result

    slippage_bps = quote.slippage_bps
    fee_bps = quote.fee_bps
    gas_usd = quote.gas_usd

    # Estimate trade value in USD for gas→bps conversion
    from_amount = int(quote.from_amount_raw) if quote.from_amount_raw.isdigit() else 0
    # Rough estimate: assume 18 decimals for simplicity in MVP
    trade_value_usd = (from_amount / 1e18) * price_a_usd if price_a_usd > 0 else 0

    gas_bps = 0.0
    if trade_value_usd > 0:
        gas_bps = (gas_usd / trade_value_usd) * 10_000

    total_cost_bps = slippage_bps + fee_bps + gas_bps

    # Liquidity score: inverse of slippage, capped at [0, 1]
    # <10 bps slippage = 1.0, >200 bps = 0.0
    if slippage_bps <= 10:
        liquidity_score = 1.0
    elif slippage_bps >= 200:
        liquidity_score = 0.0
    else:
        liquidity_score = 1.0 - (slippage_bps - 10) / 190.0

    result["cost_bps"] = round(total_cost_bps, 2)
    result["slippage_bps"] = round(slippage_bps, 2)
    result["gas_usd"] = round(gas_usd, 4)
    result["liquidity_score"] = round(liquidity_score, 4)

    return result
