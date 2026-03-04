"""Snapshot builder: assembles a complete Snapshot from all adapters."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from src.adapters.market import build_market_snapshot
from src.adapters.portfolio import fetch_portfolio
from src.adapters.quote import fetch_quote
from src.adapters.social import fetch_social_data
from src.models.snapshot import Snapshot
from src.models.request import PairSpec

logger = structlog.get_logger()


async def build_snapshot(
    client: httpx.AsyncClient,
    pair: PairSpec,
    pair_id: str = "",
    user_address: str = "",
    vault_balance_a: float | None = None,
    vault_balance_b: float | None = None,
    fetch_quote_for_amount: str | None = None,
) -> Snapshot:
    """Build a complete Snapshot for a token pair."""
    market = await build_market_snapshot(
        client,
        pair.token_a,
        pair.token_b,
        symbol_a=pair.symbol_a,
        symbol_b=pair.symbol_b,
    )

    # Fetch social data
    social = await fetch_social_data(client, pair.token_a, pair.token_b)

    quote = None
    if fetch_quote_for_amount:
        quote = await fetch_quote(
            client,
            from_token=pair.token_a,
            to_token=pair.token_b,
            from_amount_raw=fetch_quote_for_amount,
        )

    portfolio = None
    if user_address:
        portfolio = await fetch_portfolio(
            client,
            user_address=user_address,
            token_a=pair.token_a,
            token_b=pair.token_b,
            vault_balance_a=vault_balance_a,
            vault_balance_b=vault_balance_b,
        )

    return Snapshot(
        pair_id=pair_id,
        chain_id=8453,
        token_a=pair.token_a.lower(),
        token_b=pair.token_b.lower(),
        market=market,
        social=social,
        quote=quote,
        portfolio=portfolio,
        created_at=datetime.now(timezone.utc),
    )
