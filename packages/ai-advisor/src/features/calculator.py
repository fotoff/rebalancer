"""Feature calculator v2: price divergence-based features from Snapshot."""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import structlog

from src.features.cost import compute_cost_features
from src.models.features import FeatureVector
from src.models.snapshot import Snapshot

logger = structlog.get_logger()

FEATURE_VERSION = "2.0.0"


def compute_features(snapshot: Snapshot) -> FeatureVector:
    """Compute features focused on price divergence between tokens."""
    market = snapshot.market
    ta = market.token_a
    tb = market.token_b

    # --- Ratio ---
    ratio = ta.price_usd / tb.price_usd if tb.price_usd > 0 else 0.0
    log_ratio = math.log(ratio) if ratio > 0 else 0.0

    # --- Price divergence (core signal) ---
    div_1h = _divergence(ta.price_change_1h, tb.price_change_1h)
    div_6h = _divergence(ta.price_change_6h, tb.price_change_6h)
    div_24h = _divergence(ta.price_change_24h, tb.price_change_24h)

    # 7-day divergence from history
    div_7d, trend_a_7d, trend_b_7d = _compute_7d_divergence(
        market.history_a.prices, market.history_b.prices
    )

    # Max absolute divergence across all timeframes
    divs = [d for d in [div_1h, div_6h, div_24h, div_7d] if d is not None]
    abs_div_max = max(abs(d) for d in divs) if divs else None

    # Which token outperformed (for determining sell direction)
    best_div = div_24h if div_24h is not None else (div_6h or div_1h)
    outperformer = None
    if best_div is not None:
        outperformer = "A" if best_div > 0 else "B" if best_div < 0 else None

    # --- Historical volatility and z-score ---
    vol_a, vol_b = _compute_volatilities(
        market.history_a.prices, market.history_b.prices
    )
    ratio_trend_7d, zscore_ratio = _compute_ratio_zscore(
        market.history_a.prices, market.history_b.prices
    )

    # --- Social ---
    social = snapshot.social
    sentiment_a = social.sentiment_a if social else None
    sentiment_b = social.sentiment_b if social else None
    social_div = None
    if sentiment_a is not None and sentiment_b is not None:
        social_div = round(sentiment_a - sentiment_b, 3)

    # --- Cost ---
    cost_feats = compute_cost_features(snapshot.quote, ta.price_usd)

    # --- Volume ---
    has_changes = any(
        x is not None
        for x in [ta.price_change_1h, ta.price_change_24h, tb.price_change_1h, tb.price_change_24h]
    )
    has_hist = len(market.history_a.prices) > 10 and len(market.history_b.prices) > 10

    return FeatureVector(
        version=FEATURE_VERSION,
        calculated_at=datetime.now(timezone.utc),
        ratio=ratio,
        log_ratio=log_ratio,
        # Price changes
        price_change_a_1h=ta.price_change_1h,
        price_change_a_6h=ta.price_change_6h,
        price_change_a_24h=ta.price_change_24h,
        price_change_b_1h=tb.price_change_1h,
        price_change_b_6h=tb.price_change_6h,
        price_change_b_24h=tb.price_change_24h,
        # Divergence
        divergence_1h=div_1h,
        divergence_6h=div_6h,
        divergence_24h=div_24h,
        divergence_7d=div_7d,
        abs_divergence_max=abs_div_max,
        outperformer=outperformer,
        # History
        trend_a_7d=trend_a_7d,
        trend_b_7d=trend_b_7d,
        volatility_a_7d=vol_a,
        volatility_b_7d=vol_b,
        ratio_trend_7d=ratio_trend_7d,
        zscore_ratio_7d=zscore_ratio,
        # Social
        sentiment_a=sentiment_a,
        sentiment_b=sentiment_b,
        social_divergence=social_div,
        # Cost
        liquidity_score=cost_feats.get("liquidity_score"),
        cost_bps=cost_feats.get("cost_bps"),
        slippage_bps=cost_feats.get("slippage_bps"),
        gas_usd=cost_feats.get("gas_usd"),
        # Volume
        volume_a_24h=ta.volume_24h,
        volume_b_24h=tb.volume_24h,
        # Data quality
        has_price_changes=has_changes,
        has_history=has_hist,
        has_social=social is not None,
        data_complete=has_changes,
    )


def _divergence(change_a: float | None, change_b: float | None) -> float | None:
    """Price divergence = change_a - change_b (in %).

    Positive → A outperformed B.
    Negative → B outperformed A.
    """
    if change_a is None or change_b is None:
        return None
    return round(change_a - change_b, 3)


def _compute_7d_divergence(
    prices_a: list[float], prices_b: list[float]
) -> tuple[float | None, float | None, float | None]:
    """Compute 7-day return divergence from price histories."""
    trend_a = _total_return(prices_a)
    trend_b = _total_return(prices_b)

    if trend_a is not None and trend_b is not None:
        return round(trend_a - trend_b, 3), round(trend_a, 3), round(trend_b, 3)
    return None, trend_a, trend_b


def _total_return(prices: list[float]) -> float | None:
    """Total return % from oldest to newest price."""
    if len(prices) < 2:
        return None
    first = prices[0]
    last = prices[-1]
    if first <= 0:
        return None
    return round(((last - first) / first) * 100, 3)


def _compute_volatilities(
    prices_a: list[float], prices_b: list[float]
) -> tuple[float | None, float | None]:
    """Compute annualized volatility from daily price series."""
    vol_a = _annualized_vol(prices_a)
    vol_b = _annualized_vol(prices_b)
    return vol_a, vol_b


def _annualized_vol(prices: list[float]) -> float | None:
    if len(prices) < 3:
        return None
    arr = np.array(prices)
    log_returns = np.diff(np.log(arr[arr > 0]))
    if len(log_returns) < 2:
        return None
    return round(float(np.std(log_returns, ddof=1)) * math.sqrt(365), 4)


def _compute_ratio_zscore(
    prices_a: list[float], prices_b: list[float]
) -> tuple[float | None, float | None]:
    """Compute ratio trend and z-score from aligned price histories."""
    if len(prices_a) < 5 or len(prices_b) < 5:
        return None, None

    min_len = min(len(prices_a), len(prices_b))
    pa = np.array(prices_a[-min_len:])
    pb = np.array(prices_b[-min_len:])

    mask = pb > 0
    if mask.sum() < 5:
        return None, None

    ratios = pa[mask] / pb[mask]
    current = ratios[-1]
    mean = float(np.mean(ratios))
    std = float(np.std(ratios, ddof=1))

    trend = None
    if ratios[0] > 0:
        trend = round(((current - ratios[0]) / ratios[0]) * 100, 3)

    zscore = None
    if std > 1e-12:
        zscore = round((current - mean) / std, 3)

    return trend, zscore
