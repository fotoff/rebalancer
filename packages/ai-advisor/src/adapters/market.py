"""Market data adapter: DexScreener prices + price changes + CoinGecko history."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from src.config import settings
from src.models.snapshot import MarketSnapshot, TokenPrice, PriceHistory

logger = structlog.get_logger()

NETWORK = "base"


async def fetch_token_data(
    client: httpx.AsyncClient, addresses: list[str]
) -> dict[str, dict]:
    """Fetch current prices AND price changes from DexScreener.

    Returns dict keyed by lowercase address with:
      price_usd, price_change_1h, price_change_6h, price_change_24h
    """
    result: dict[str, dict] = {}
    chunk_size = 30
    for i in range(0, len(addresses), chunk_size):
        chunk = addresses[i : i + chunk_size]
        url = f"{settings.dexscreener_api_url}/tokens/v1/base/{','.join(chunk)}"
        try:
            resp = await client.get(url, timeout=10.0)
            if resp.status_code != 200:
                logger.warning("dexscreener_error", status=resp.status_code)
                continue
            pairs = resp.json()
            for p in pairs:
                base_addr = (p.get("baseToken", {}).get("address") or "").lower()
                price_str = p.get("priceUsd", "0")
                price = float(price_str) if price_str else 0.0

                if not base_addr or price <= 0 or base_addr in result:
                    continue

                pc = p.get("priceChange", {})
                result[base_addr] = {
                    "price_usd": price,
                    "price_change_m5": _safe_float(pc.get("m5")),
                    "price_change_1h": _safe_float(pc.get("h1")),
                    "price_change_6h": _safe_float(pc.get("h6")),
                    "price_change_24h": _safe_float(pc.get("h24")),
                    "volume_24h": _safe_float(p.get("volume", {}).get("h24")),
                    "liquidity_usd": _safe_float(
                        p.get("liquidity", {}).get("usd")
                    ),
                    "fdv": _safe_float(p.get("fdv")),
                }
        except Exception as e:
            logger.error("dexscreener_fetch_failed", error=str(e))
    return result


async def fetch_price_history(
    client: httpx.AsyncClient, token_address: str, days: int = 7
) -> list[float]:
    """Fetch historical daily prices from CoinGecko (by contract address on Base).

    Returns list of daily close prices (oldest first).
    """
    url = (
        f"https://api.coingecko.com/api/v3/coins/base/contract"
        f"/{token_address.lower()}/market_chart/"
    )
    try:
        resp = await client.get(
            url,
            params={"vs_currency": "usd", "days": str(days)},
            timeout=15.0,
        )
        if resp.status_code == 429:
            logger.warning("coingecko_rate_limited", token=token_address[:10])
            return []
        if resp.status_code != 200:
            logger.warning(
                "coingecko_error",
                status=resp.status_code,
                token=token_address[:10],
            )
            return []
        data = resp.json()
        prices_raw = data.get("prices", [])
        return [float(p[1]) for p in prices_raw if len(p) >= 2 and p[1] > 0]
    except Exception as e:
        logger.error("coingecko_fetch_failed", token=token_address[:10], error=str(e))
        return []


async def build_market_snapshot(
    client: httpx.AsyncClient,
    token_a_addr: str,
    token_b_addr: str,
    symbol_a: str = "",
    symbol_b: str = "",
) -> MarketSnapshot:
    """Build market snapshot focused on price dynamics of each token."""
    addr_a = token_a_addr.lower()
    addr_b = token_b_addr.lower()

    # 1. Fetch current prices + price changes from DexScreener
    token_data = await fetch_token_data(client, [addr_a, addr_b])
    data_a = token_data.get(addr_a, {})
    data_b = token_data.get(addr_b, {})

    price_a = data_a.get("price_usd", 0.0)
    price_b = data_b.get("price_usd", 0.0)

    # 2. Fetch 7-day price history from CoinGecko for trend analysis
    history_a: list[float] = []
    history_b: list[float] = []
    try:
        history_a = await fetch_price_history(client, addr_a, days=7)
    except Exception:
        pass
    try:
        history_b = await fetch_price_history(client, addr_b, days=7)
    except Exception:
        pass

    ratio = price_a / price_b if price_b > 0 else 0.0
    now = datetime.now(timezone.utc)

    logger.info(
        "market_snapshot_built",
        ratio=round(ratio, 6),
        price_a=round(price_a, 4),
        price_b=round(price_b, 4),
        change_a_24h=data_a.get("price_change_24h"),
        change_b_24h=data_b.get("price_change_24h"),
        history_a_pts=len(history_a),
        history_b_pts=len(history_b),
    )

    return MarketSnapshot(
        token_a=TokenPrice(
            address=addr_a,
            symbol=symbol_a,
            price_usd=price_a,
            price_change_1h=data_a.get("price_change_1h"),
            price_change_6h=data_a.get("price_change_6h"),
            price_change_24h=data_a.get("price_change_24h"),
            volume_24h=data_a.get("volume_24h"),
            liquidity_usd=data_a.get("liquidity_usd"),
            timestamp=now,
        ),
        token_b=TokenPrice(
            address=addr_b,
            symbol=symbol_b,
            price_usd=price_b,
            price_change_1h=data_b.get("price_change_1h"),
            price_change_6h=data_b.get("price_change_6h"),
            price_change_24h=data_b.get("price_change_24h"),
            volume_24h=data_b.get("volume_24h"),
            liquidity_usd=data_b.get("liquidity_usd"),
            timestamp=now,
        ),
        ratio=ratio,
        history_a=PriceHistory(prices=history_a, interval="hourly"),
        history_b=PriceHistory(prices=history_b, interval="hourly"),
        fetched_at=now,
    )


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
