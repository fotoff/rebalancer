from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FeatureVector(BaseModel):
    version: str = "2.0.0"
    calculated_at: datetime = Field(default_factory=_utcnow)

    # Current ratio
    ratio: float = Field(description="pA / pB")
    log_ratio: float = Field(description="log(pA) - log(pB)")

    # --- Price changes per token (from DexScreener, in %) ---
    price_change_a_1h: float | None = None
    price_change_a_6h: float | None = None
    price_change_a_24h: float | None = None
    price_change_b_1h: float | None = None
    price_change_b_6h: float | None = None
    price_change_b_24h: float | None = None

    # --- Price divergence (key signal) ---
    divergence_1h: float | None = Field(
        None, description="change_a_1h - change_b_1h (in %)"
    )
    divergence_6h: float | None = Field(
        None, description="change_a_6h - change_b_6h (in %)"
    )
    divergence_24h: float | None = Field(
        None, description="change_a_24h - change_b_24h (in %)"
    )
    divergence_7d: float | None = Field(
        None, description="7-day price divergence from history (in %)"
    )
    abs_divergence_max: float | None = Field(
        None, description="Max |divergence| across timeframes"
    )
    outperformer: str | None = Field(
        None, description="Which token outperformed: 'A' or 'B'"
    )

    # --- Historical trend (from CoinGecko 7d) ---
    trend_a_7d: float | None = Field(None, description="Token A 7d return %")
    trend_b_7d: float | None = Field(None, description="Token B 7d return %")
    volatility_a_7d: float | None = Field(None, description="Token A 7d price volatility")
    volatility_b_7d: float | None = Field(None, description="Token B 7d price volatility")
    ratio_trend_7d: float | None = Field(None, description="Ratio change over 7d (%)")
    zscore_ratio_7d: float | None = Field(None, description="Z-score of current ratio vs 7d history")

    # --- Social signals ---
    sentiment_a: float | None = Field(None, description="Social sentiment A: -1..+1")
    sentiment_b: float | None = Field(None, description="Social sentiment B: -1..+1")
    social_divergence: float | None = Field(
        None, description="sentiment_a - sentiment_b"
    )

    # --- Liquidity / cost ---
    liquidity_score: float | None = Field(None, description="0-1 proxy")
    cost_bps: float | None = Field(None, description="Total cost in bps")
    slippage_bps: float | None = None
    gas_usd: float | None = None

    # Volume
    volume_a_24h: float | None = None
    volume_b_24h: float | None = None

    # Data quality
    has_price_changes: bool = False
    has_history: bool = False
    has_social: bool = False
    data_complete: bool = True
