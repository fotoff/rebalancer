"""Portfolio adapter: vault and wallet balances from Next.js API or direct RPC."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from src.config import settings
from src.models.snapshot import PortfolioSnapshot

logger = structlog.get_logger()


async def fetch_portfolio(
    client: httpx.AsyncClient,
    user_address: str,
    token_a: str,
    token_b: str,
    vault_balance_a: float | None = None,
    vault_balance_b: float | None = None,
) -> PortfolioSnapshot:
    """Build portfolio snapshot.

    If vault_balance_a/b are provided (from the frontend), use them directly.
    Otherwise, could query on-chain — but for MVP, balances come from the request.
    """
    return PortfolioSnapshot(
        user_address=user_address,
        vault_balance_a=vault_balance_a or 0.0,
        vault_balance_b=vault_balance_b or 0.0,
        fetched_at=datetime.now(timezone.utc),
    )
