"""Policy engine: runs all guardrail checks and returns PolicyResult."""

from __future__ import annotations

from datetime import datetime

import structlog

from src.config import settings
from src.models.features import FeatureVector
from src.models.recommendation import PolicyResult, PolicyViolation
from src.models.request import UserConstraints
from src.models.snapshot import Snapshot
from src.policy import rules
from src.policy.violation import BLOCK

logger = structlog.get_logger()


def evaluate_policy(
    features: FeatureVector,
    snapshot: Snapshot,
    expected_edge_bps: float,
    rebalance_pct: float,
    constraints: UserConstraints | None = None,
    last_action_ts: datetime | None = None,
    daily_turnover_pct: float = 0.0,
) -> PolicyResult:
    """Run all policy checks and return aggregated result."""
    constraints = constraints or UserConstraints()
    violations: list[PolicyViolation] = []

    # 1. MAX_SLIPPAGE_BPS
    max_slip = constraints.max_slippage_bps or settings.max_slippage_bps
    v = rules.check_max_slippage(features.slippage_bps, max_slip)
    if v:
        violations.append(v)

    # 2. MAX_GAS_USD
    max_gas = constraints.max_gas_usd or settings.max_gas_usd
    v = rules.check_max_gas(features.gas_usd, max_gas)
    if v:
        violations.append(v)

    # 3. MIN_LIQUIDITY_SCORE
    v = rules.check_min_liquidity(features.liquidity_score, settings.min_liquidity_score)
    if v:
        violations.append(v)

    # 4. MIN_EDGE_AFTER_COST_BPS
    min_edge = constraints.min_edge_bps or settings.min_edge_after_cost_bps
    v = rules.check_min_edge(expected_edge_bps, min_edge)
    if v:
        violations.append(v)

    # 5. MAX_TRADE_PCT_OF_BALANCE
    max_pct = constraints.max_trade_pct or settings.max_trade_pct
    v = rules.check_max_trade_pct(rebalance_pct, max_pct)
    if v:
        violations.append(v)

    # 6. COOLDOWN_MINUTES
    cooldown = constraints.cooldown_minutes or settings.cooldown_minutes
    v = rules.check_cooldown(last_action_ts, cooldown)
    if v:
        violations.append(v)

    # 7. MAX_DAILY_TURNOVER_PCT
    v = rules.check_daily_turnover(daily_turnover_pct, settings.max_daily_turnover_pct)
    if v:
        violations.append(v)

    # 8. DATA_STALENESS_SECONDS
    v = rules.check_data_staleness(
        snapshot.market.fetched_at, settings.data_staleness_seconds
    )
    if v:
        violations.append(v)

    # 9. TOKEN_DENYLIST (from user constraints)
    if constraints.denylist:
        v = rules.check_token_denylist(
            snapshot.token_a, snapshot.token_b, constraints.denylist
        )
        if v:
            violations.append(v)

    has_block = any(v.severity == BLOCK for v in violations)
    passed = not has_block

    if not passed:
        block_codes = [v.code for v in violations if v.severity == BLOCK]
        logger.info("policy_blocked", violations=block_codes)

    return PolicyResult(passed=passed, violations=violations)
