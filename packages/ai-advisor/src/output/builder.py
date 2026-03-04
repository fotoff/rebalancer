"""Output builder: assembles the final Recommendation from all pipeline stages."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog

from src.models.features import FeatureVector
from src.models.recommendation import (
    Action,
    Explanation,
    ExpectedMetrics,
    PolicyResult,
    ReasonFactor,
    Recommendation,
    TriggerSuggestion,
    TradeDetails,
)
from src.signals.engine import SignalResult

logger = structlog.get_logger()


def build_recommendation(
    signal: SignalResult,
    features: FeatureVector,
    policy: PolicyResult,
    explanation: Explanation,
    token_a: str,
    token_b: str,
    symbol_a: str = "",
    symbol_b: str = "",
    chain_id: int = 8453,
) -> Recommendation:
    """Assemble final Recommendation JSON.

    If policy blocked the action, override to HOLD.
    """
    action = signal.action
    if not policy.passed:
        action = Action.HOLD

    trade = None
    if action == Action.REBALANCE_NOW:
        trade = TradeDetails(
            sell_token=token_a if signal.sell_direction == "1to2" else token_b,
            buy_token=token_b if signal.sell_direction == "1to2" else token_a,
            sell_amount=str(round(signal.rebalance_pct, 2)) + "%",
        )

    triggers: list[TriggerSuggestion] = []
    if action in (Action.SUGGEST_TRIGGERS, Action.REBALANCE_NOW):
        triggers = signal.triggers

    rec = Recommendation(
        version="1.0.0",
        pair={
            "tokenA": token_a,
            "tokenB": token_b,
            "symbolA": symbol_a,
            "symbolB": symbol_b,
        },
        chain_id=chain_id,
        timestamp=datetime.now(timezone.utc),
        action=action,
        expected=ExpectedMetrics(
            expected_edge_bps=signal.expected_edge_bps,
            cost_bps=signal.cost_bps,
            p_win=signal.p_win,
            regime=signal.regime,
        ),
        policy=policy,
        reasons=signal.reasons,
        explain=explanation,
        trade=trade,
        triggers_suggestion=triggers,
        feature_version=features.version,
        model_version="mvp-heuristic",
        recommendation_id=str(uuid.uuid4()),
    )

    try:
        rec.model_validate(rec.model_dump())
    except Exception as e:
        logger.error("recommendation_validation_failed", error=str(e))
        return _hold_fallback(token_a, token_b, symbol_a, symbol_b, chain_id, str(e))

    return rec


def _hold_fallback(
    token_a: str,
    token_b: str,
    symbol_a: str,
    symbol_b: str,
    chain_id: int,
    error_msg: str,
) -> Recommendation:
    """Return a safe HOLD recommendation when something fails."""
    return Recommendation(
        version="1.0.0",
        pair={
            "tokenA": token_a,
            "tokenB": token_b,
            "symbolA": symbol_a,
            "symbolB": symbol_b,
        },
        chain_id=chain_id,
        timestamp=datetime.now(timezone.utc),
        action=Action.HOLD,
        expected=ExpectedMetrics(
            expected_edge_bps=0,
            cost_bps=0,
            p_win=0.5,
            regime="NEUTRAL",
        ),
        policy=PolicyResult(passed=False, violations=[]),
        reasons=[],
        explain=Explanation(
            short="Ошибка при формировании рекомендации. Рекомендуется ожидание.",
            details=f"Внутренняя ошибка: {error_msg}",
        ),
        recommendation_id=str(uuid.uuid4()),
    )
