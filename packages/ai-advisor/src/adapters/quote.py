"""Quote adapter: LI.FI swap quotes for slippage/cost/gas estimation."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from src.config import settings
from src.models.snapshot import QuoteSnapshot

logger = structlog.get_logger()


async def fetch_quote(
    client: httpx.AsyncClient,
    from_token: str,
    to_token: str,
    from_amount_raw: str,
    from_address: str | None = None,
    slippage: str = "0.01",
) -> QuoteSnapshot | None:
    """Get swap quote from LI.FI API."""
    sender = from_address or settings.vault_address
    if not sender:
        logger.error("no_from_address_for_quote")
        return None

    params = {
        "fromChain": str(settings.chain_id),
        "toChain": str(settings.chain_id),
        "fromToken": from_token,
        "toToken": to_token,
        "fromAmount": from_amount_raw,
        "fromAddress": sender,
        "slippage": slippage,
        "order": "CHEAPEST",
    }
    url = f"{settings.lifi_api_url}/quote"

    try:
        resp = await client.get(url, params=params)
        if resp.status_code != 200:
            logger.warning(
                "lifi_quote_error", status=resp.status_code, body=resp.text[:500]
            )
            return None

        data = resp.json()
        estimate = data.get("estimate", {})
        tx_req = data.get("transactionRequest", {})

        to_amount = estimate.get("toAmount", "0")
        to_amount_min = estimate.get("toAmountMin", "0")
        gas_costs = estimate.get("gasCosts", [])
        gas_usd = sum(float(g.get("amountUSD", "0")) for g in gas_costs)
        fee_costs = estimate.get("feeCosts", [])
        fee_pct = sum(float(f.get("percentage", "0")) for f in fee_costs)

        from_amt = int(from_amount_raw) if from_amount_raw.isdigit() else 0
        to_amt = int(to_amount) if to_amount.isdigit() else 0
        slippage_bps = 0.0
        if from_amt > 0 and to_amt > 0:
            to_min = int(to_amount_min) if to_amount_min.isdigit() else to_amt
            slippage_bps = (1 - to_min / to_amt) * 10_000 if to_amt else 0

        return QuoteSnapshot(
            from_token=from_token.lower(),
            to_token=to_token.lower(),
            from_amount_raw=from_amount_raw,
            to_amount_raw=to_amount,
            to_amount_min_raw=to_amount_min,
            slippage_bps=round(slippage_bps, 2),
            gas_usd=round(gas_usd, 4),
            fee_bps=round(fee_pct * 10_000, 2),
            swap_target=tx_req.get("to", ""),
            swap_calldata=tx_req.get("data", ""),
            fetched_at=datetime.now(timezone.utc),
        )
    except Exception as e:
        logger.error("lifi_quote_failed", error=str(e))
        return None
