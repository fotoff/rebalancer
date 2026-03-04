"""POST /ai/suggest-pairs — suggest token pairs from portfolio for monitoring."""

from __future__ import annotations

from itertools import combinations

from fastapi import APIRouter, Depends, Request
import structlog

from src.adapters.market import fetch_token_data
from src.auth import verify_service_auth
from src.models.request import SuggestPairsRequest

logger = structlog.get_logger()
router = APIRouter()

# Known stablecoins — don't pair two stablecoins together
STABLECOINS = {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",  # USDC
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",  # USDbC
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",  # DAI
}


@router.post("/ai/suggest-pairs", dependencies=[Depends(verify_service_auth)])
async def suggest_pairs(req: SuggestPairsRequest, request: Request):
    client = request.app.state.http_client

    # Filter holdings by min balance
    holdings = [
        h for h in req.holdings
        if h.usd_value >= req.min_balance_usd
        and h.token.lower() not in {e.lower() for e in req.exclude_tokens}
    ]

    if len(holdings) < 2:
        return {"pairs": [], "message": "Need at least 2 eligible tokens"}

    # Fetch prices to confirm they're tradeable
    addresses = [h.token.lower() for h in holdings]
    token_data = await fetch_token_data(client, addresses)

    tradeable = [h for h in holdings if token_data.get(h.token.lower(), {}).get("price_usd", 0) > 0]
    if len(tradeable) < 2:
        return {"pairs": [], "message": "Not enough tokens with available prices"}

    # Generate candidate pairs
    pairs = []
    for a, b in combinations(tradeable, 2):
        addr_a = a.token.lower()
        addr_b = b.token.lower()

        # Skip stablecoin-stablecoin pairs
        if addr_a in STABLECOINS and addr_b in STABLECOINS:
            continue

        # Score: higher combined USD value = more interesting
        score = a.usd_value + b.usd_value

        # Boost pairs with one stablecoin (classic rebalance setup)
        if addr_a in STABLECOINS or addr_b in STABLECOINS:
            score *= 1.5

        pairs.append({
            "tokenA": a.token,
            "tokenB": b.token,
            "symbolA": a.symbol,
            "symbolB": b.symbol,
            "score": round(score, 2),
            "rationale": _rationale(a, b),
            "flags": [],
        })

    pairs.sort(key=lambda p: p["score"], reverse=True)
    return {"pairs": pairs[:20]}


def _rationale(a, b) -> str:
    a_stable = a.token.lower() in STABLECOINS
    b_stable = b.token.lower() in STABLECOINS
    if a_stable or b_stable:
        volatile = b.symbol if a_stable else a.symbol
        stable = a.symbol if a_stable else b.symbol
        return f"{volatile}/{stable}: ребаланс волатильного актива против стейбла"
    return f"{a.symbol}/{b.symbol}: ребаланс двух волатильных активов"
