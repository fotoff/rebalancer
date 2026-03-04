from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TokenPrice(BaseModel):
    address: str
    symbol: str = ""
    price_usd: float
    price_change_1h: float | None = None
    price_change_6h: float | None = None
    price_change_24h: float | None = None
    volume_24h: float | None = None
    liquidity_usd: float | None = None
    timestamp: datetime = Field(default_factory=_utcnow)


class PriceHistory(BaseModel):
    """Historical prices (oldest first) from CoinGecko."""
    prices: list[float] = Field(default_factory=list)
    interval: str = Field("hourly", description="hourly or daily")


class MarketSnapshot(BaseModel):
    token_a: TokenPrice
    token_b: TokenPrice
    ratio: float = Field(description="price_a / price_b")
    history_a: PriceHistory = Field(default_factory=PriceHistory)
    history_b: PriceHistory = Field(default_factory=PriceHistory)
    fetched_at: datetime = Field(default_factory=_utcnow)


class SocialSnapshot(BaseModel):
    """Social/Twitter signal data for a token pair."""
    sentiment_a: float | None = Field(None, description="-1 to +1 sentiment score for token A")
    sentiment_b: float | None = Field(None, description="-1 to +1 sentiment score for token B")
    mentions_a_24h: int | None = Field(None, description="Twitter mentions count 24h")
    mentions_b_24h: int | None = Field(None, description="Twitter mentions count 24h")
    buzz_delta_a: float | None = Field(None, description="Change in social volume vs avg")
    buzz_delta_b: float | None = Field(None, description="Change in social volume vs avg")
    news_sentiment: float | None = Field(None, description="Aggregated news sentiment")
    fetched_at: datetime = Field(default_factory=_utcnow)


class QuoteSnapshot(BaseModel):
    from_token: str
    to_token: str
    from_amount_raw: str = Field(description="Raw amount in smallest units")
    to_amount_raw: str = ""
    to_amount_min_raw: str = ""
    slippage_bps: float = 0
    gas_usd: float = 0
    fee_bps: float = 0
    swap_target: str = ""
    swap_calldata: str = ""
    fetched_at: datetime = Field(default_factory=_utcnow)


class PortfolioSnapshot(BaseModel):
    user_address: str
    vault_balance_a: float = Field(description="Token A vault balance (human-readable)")
    vault_balance_b: float = Field(description="Token B vault balance (human-readable)")
    wallet_balance_a: float = 0
    wallet_balance_b: float = 0
    fetched_at: datetime = Field(default_factory=_utcnow)


class Snapshot(BaseModel):
    pair_id: str = ""
    chain_id: int = 8453
    token_a: str = Field(description="Token A address")
    token_b: str = Field(description="Token B address")
    market: MarketSnapshot
    social: SocialSnapshot | None = None
    quote: QuoteSnapshot | None = None
    portfolio: PortfolioSnapshot | None = None
    created_at: datetime = Field(default_factory=_utcnow)
