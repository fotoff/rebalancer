"""Shared test fixtures."""

import os

os.environ.setdefault("AI_SERVICE_SECRET", "test-secret-key-for-testing-only-32chars")
os.environ.setdefault("AI_OPENAI_API_KEY", "")
os.environ.setdefault("AI_LLM_ENABLED", "false")

import pytest
from datetime import datetime, timezone

from src.models.snapshot import (
    MarketSnapshot,
    OHLCVBar,
    PortfolioSnapshot,
    QuoteSnapshot,
    Snapshot,
    TokenPrice,
)
from src.models.features import FeatureVector


@pytest.fixture
def sample_ohlcv_bars():
    """Generate 30 days of synthetic OHLCV bars."""
    import math
    bars = []
    base_price = 100.0
    for i in range(30):
        # Sine wave + small trend
        noise = math.sin(i * 0.5) * 5 + i * 0.2
        close = base_price + noise
        bars.append(
            OHLCVBar(
                timestamp=datetime(2026, 1, 1 + i, tzinfo=timezone.utc),
                open=close - 1,
                high=close + 2,
                low=close - 2,
                close=close,
                volume=1000.0,
            )
        )
    return bars


@pytest.fixture
def sample_market_snapshot(sample_ohlcv_bars):
    now = datetime.now(timezone.utc)
    return MarketSnapshot(
        token_a=TokenPrice(
            address="0xaaa", symbol="AAA", price_usd=100.0, timestamp=now
        ),
        token_b=TokenPrice(
            address="0xbbb", symbol="BBB", price_usd=50.0, timestamp=now
        ),
        ratio=2.0,
        ohlcv_a=sample_ohlcv_bars,
        ohlcv_b=sample_ohlcv_bars,
        ohlcv_ratio=[
            OHLCVBar(
                timestamp=b.timestamp,
                open=b.open / 50,
                high=b.high / 49,
                low=b.low / 51,
                close=b.close / 50,
                volume=b.volume,
            )
            for b in sample_ohlcv_bars
        ],
        fetched_at=now,
    )


@pytest.fixture
def sample_quote():
    return QuoteSnapshot(
        from_token="0xaaa",
        to_token="0xbbb",
        from_amount_raw="1000000000000000000",
        to_amount_raw="2000000000000000000",
        to_amount_min_raw="1980000000000000000",
        slippage_bps=10.0,
        gas_usd=0.5,
        fee_bps=3.0,
        fetched_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def sample_snapshot(sample_market_snapshot, sample_quote):
    return Snapshot(
        pair_id="test-pair",
        chain_id=8453,
        token_a="0xaaa",
        token_b="0xbbb",
        market=sample_market_snapshot,
        quote=sample_quote,
        portfolio=PortfolioSnapshot(
            user_address="0xuser",
            vault_balance_a=10.0,
            vault_balance_b=20.0,
        ),
    )
