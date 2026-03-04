"""POST /ai/refresh-quote-and-validate — pre-execution validation."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
import structlog

from src.adapters.quote import fetch_quote
from src.auth import verify_service_auth
from src.config import settings
from src.models.recommendation import Action, PolicyResult
from src.models.request import ValidateRequest
from src.policy import rules

logger = structlog.get_logger()
router = APIRouter()


@router.post("/ai/refresh-quote-and-validate", dependencies=[Depends(verify_service_auth)])
async def refresh_and_validate(req: ValidateRequest, request: Request):
    """Re-fetch quote and re-validate policy before execution.

    Returns updated policy status — if conditions deteriorated, action → HOLD.
    """
    client = request.app.state.http_client

    trade = req.trade or {}
    from_token = trade.get("sell_token", "")
    to_token = trade.get("buy_token", "")
    sell_amount_raw = trade.get("sell_amount_raw", "")

    if not from_token or not to_token or not sell_amount_raw:
        return {
            "action": Action.HOLD.value,
            "policy": PolicyResult(
                passed=False,
                violations=[],
            ).model_dump(),
            "reason": "Missing trade parameters",
        }

    max_slip = req.max_slippage_bps or settings.max_slippage_bps

    # Fetch fresh quote
    quote = await fetch_quote(
        client,
        from_token=from_token,
        to_token=to_token,
        from_amount_raw=sell_amount_raw,
        slippage=str(max_slip / 10_000),
    )

    if not quote:
        return {
            "action": Action.HOLD.value,
            "policy": PolicyResult(passed=False, violations=[]).model_dump(),
            "reason": "Quote unavailable — cannot validate execution",
        }

    # Quick policy checks on fresh quote
    violations = []

    v = rules.check_max_slippage(quote.slippage_bps, max_slip)
    if v:
        violations.append(v)

    v = rules.check_max_gas(quote.gas_usd, settings.max_gas_usd)
    if v:
        violations.append(v)

    has_block = any(v.severity == "BLOCK" for v in violations)
    action = Action.HOLD if has_block else Action.REBALANCE_NOW

    result = {
        "action": action.value,
        "policy": PolicyResult(
            passed=not has_block,
            violations=violations,
        ).model_dump(mode="json"),
        "cost_bps": round(quote.slippage_bps + quote.fee_bps, 2),
        "gas_usd": quote.gas_usd,
        "to_amount_raw": quote.to_amount_raw,
        "to_amount_min_raw": quote.to_amount_min_raw,
        "swap_target": quote.swap_target,
        "swap_calldata": quote.swap_calldata,
        "ttl_seconds": 60,
    }

    logger.info(
        "validation_result",
        action=action.value,
        passed=not has_block,
        slippage=quote.slippage_bps,
        gas=quote.gas_usd,
    )

    return result
