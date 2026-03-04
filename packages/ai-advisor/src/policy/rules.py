"""Individual policy rules. Each returns a violation or None."""

from __future__ import annotations

from datetime import datetime, timezone

from src.models.recommendation import PolicyViolation
from src.policy import violation as codes


def check_max_slippage(slippage_bps: float | None, limit: int) -> PolicyViolation | None:
    if slippage_bps is None:
        return None
    if slippage_bps > limit:
        return PolicyViolation(
            code=codes.MAX_SLIPPAGE_BPS,
            severity=codes.BLOCK,
            actual=slippage_bps,
            limit=float(limit),
            message=f"Slippage {slippage_bps:.1f} bps exceeds max {limit} bps",
        )
    if slippage_bps > limit * 0.7:
        return PolicyViolation(
            code=codes.MAX_SLIPPAGE_BPS,
            severity=codes.WARN,
            actual=slippage_bps,
            limit=float(limit),
            message=f"Slippage {slippage_bps:.1f} bps approaching limit {limit} bps",
        )
    return None


def check_max_gas(gas_usd: float | None, limit: float) -> PolicyViolation | None:
    if gas_usd is None:
        return None
    if gas_usd > limit:
        return PolicyViolation(
            code=codes.MAX_GAS_USD,
            severity=codes.BLOCK,
            actual=gas_usd,
            limit=limit,
            message=f"Gas ${gas_usd:.2f} exceeds max ${limit:.2f}",
        )
    if gas_usd > limit * 0.7:
        return PolicyViolation(
            code=codes.MAX_GAS_USD,
            severity=codes.WARN,
            actual=gas_usd,
            limit=limit,
            message=f"Gas ${gas_usd:.2f} approaching limit ${limit:.2f}",
        )
    return None


def check_min_liquidity(
    liquidity_score: float | None, limit: float
) -> PolicyViolation | None:
    if liquidity_score is None:
        return PolicyViolation(
            code=codes.MIN_LIQUIDITY_SCORE,
            severity=codes.WARN,
            actual=0.0,
            limit=limit,
            message="Liquidity score unavailable",
        )
    if liquidity_score < limit:
        return PolicyViolation(
            code=codes.MIN_LIQUIDITY_SCORE,
            severity=codes.BLOCK,
            actual=liquidity_score,
            limit=limit,
            message=f"Liquidity score {liquidity_score:.2f} below minimum {limit:.2f}",
        )
    return None


def check_min_edge(edge_bps: float, limit: float) -> PolicyViolation | None:
    if edge_bps < limit:
        sev = codes.BLOCK if edge_bps < 0 else codes.WARN
        return PolicyViolation(
            code=codes.MIN_EDGE_AFTER_COST_BPS,
            severity=sev,
            actual=edge_bps,
            limit=limit,
            message=f"Expected edge {edge_bps:.1f} bps {'negative' if edge_bps < 0 else 'below minimum'} {limit:.1f} bps",
        )
    return None


def check_max_trade_pct(trade_pct: float, limit: float) -> PolicyViolation | None:
    if trade_pct > limit:
        return PolicyViolation(
            code=codes.MAX_TRADE_PCT_OF_BALANCE,
            severity=codes.BLOCK,
            actual=trade_pct,
            limit=limit,
            message=f"Trade size {trade_pct:.1f}% exceeds max {limit:.1f}%",
        )
    return None


def check_cooldown(
    last_action_ts: datetime | None, cooldown_min: int
) -> PolicyViolation | None:
    if last_action_ts is None:
        return None
    now = datetime.now(timezone.utc)
    elapsed_min = (now - last_action_ts).total_seconds() / 60
    if elapsed_min < cooldown_min:
        return PolicyViolation(
            code=codes.COOLDOWN_MINUTES,
            severity=codes.BLOCK,
            actual=round(elapsed_min, 1),
            limit=float(cooldown_min),
            message=f"Cooldown: {elapsed_min:.0f} min since last action (min {cooldown_min} min)",
        )
    return None


def check_daily_turnover(
    daily_turnover_pct: float, limit: float
) -> PolicyViolation | None:
    if daily_turnover_pct > limit:
        return PolicyViolation(
            code=codes.MAX_DAILY_TURNOVER_PCT,
            severity=codes.BLOCK,
            actual=daily_turnover_pct,
            limit=limit,
            message=f"Daily turnover {daily_turnover_pct:.1f}% exceeds max {limit:.1f}%",
        )
    return None


def check_data_staleness(
    data_timestamp: datetime, max_staleness_sec: int
) -> PolicyViolation | None:
    now = datetime.now(timezone.utc)
    age_sec = (now - data_timestamp).total_seconds()
    if age_sec > max_staleness_sec:
        return PolicyViolation(
            code=codes.DATA_STALENESS_SECONDS,
            severity=codes.BLOCK,
            actual=age_sec,
            limit=float(max_staleness_sec),
            message=f"Data is {age_sec:.0f}s old (max {max_staleness_sec}s)",
        )
    return None


def check_token_denylist(
    token_a: str, token_b: str, denylist: list[str]
) -> PolicyViolation | None:
    denied = set(t.lower() for t in denylist)
    for token in [token_a.lower(), token_b.lower()]:
        if token in denied:
            return PolicyViolation(
                code=codes.TOKEN_DENIED,
                severity=codes.BLOCK,
                actual=0,
                limit=0,
                message=f"Token {token} is on the deny list",
            )
    return None
