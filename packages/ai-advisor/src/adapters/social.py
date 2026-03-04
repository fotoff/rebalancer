"""Social data adapter: CoinGecko community data + Twitter API (extensible).

MVP: CoinGecko community_data (twitter_followers, sentiment_votes).
Future: Twitter API v2 search, LunarCrush, CryptoPanic.
"""

from __future__ import annotations

import httpx
import structlog

from src.config import settings
from src.models.snapshot import SocialSnapshot

logger = structlog.get_logger()


async def fetch_social_data(
    client: httpx.AsyncClient,
    token_a_addr: str,
    token_b_addr: str,
) -> SocialSnapshot | None:
    """Fetch social/community signals for both tokens."""
    if not settings.social_enabled:
        return None

    try:
        data_a = await _fetch_coingecko_community(client, token_a_addr)
        data_b = await _fetch_coingecko_community(client, token_b_addr)

        if not data_a and not data_b:
            return None

        snapshot = SocialSnapshot(
            sentiment_a=_compute_sentiment(data_a),
            sentiment_b=_compute_sentiment(data_b),
            mentions_a_24h=data_a.get("twitter_followers") if data_a else None,
            mentions_b_24h=data_b.get("twitter_followers") if data_b else None,
            buzz_delta_a=data_a.get("buzz_delta") if data_a else None,
            buzz_delta_b=data_b.get("buzz_delta") if data_b else None,
        )

        logger.info(
            "social_data_fetched",
            sentiment_a=snapshot.sentiment_a,
            sentiment_b=snapshot.sentiment_b,
        )
        return snapshot

    except Exception as e:
        logger.error("social_fetch_failed", error=str(e))
        return None


async def _fetch_coingecko_community(
    client: httpx.AsyncClient, token_address: str
) -> dict | None:
    """Fetch community/social data from CoinGecko by contract address."""
    url = (
        f"https://api.coingecko.com/api/v3/coins/base/contract"
        f"/{token_address.lower()}"
    )
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code == 429:
            logger.warning("coingecko_social_rate_limited")
            return None
        if resp.status_code != 200:
            return None

        data = resp.json()
        community = data.get("community_data", {})
        sentiment = data.get("sentiment_votes_up_percentage", 0)
        market_data = data.get("market_data", {})

        # Price change data from CoinGecko as cross-validation
        price_change_7d = market_data.get("price_change_percentage_7d", 0)

        result = {
            "twitter_followers": community.get("twitter_followers"),
            "sentiment_up_pct": sentiment,
            "price_change_7d_cg": price_change_7d,
        }

        # Buzz delta: compare current social interest to baseline
        # CoinGecko doesn't directly give this, but we can use
        # developer_data as a proxy for project activity
        dev = data.get("developer_data", {})
        if dev:
            commits_4w = dev.get("commit_count_4_weeks", 0) or 0
            result["dev_activity"] = commits_4w

        return result

    except Exception as e:
        logger.error(
            "coingecko_community_failed",
            token=token_address[:10],
            error=str(e),
        )
        return None


def _compute_sentiment(data: dict | None) -> float | None:
    """Convert CoinGecko sentiment votes to -1..+1 score."""
    if not data:
        return None
    up_pct = data.get("sentiment_up_pct", 0)
    if not up_pct:
        return None
    return round((up_pct - 50) / 50, 3)
