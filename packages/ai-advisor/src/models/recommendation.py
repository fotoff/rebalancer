from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Action(str, Enum):
    HOLD = "HOLD"
    REBALANCE_NOW = "REBALANCE_NOW"
    SUGGEST_TRIGGERS = "SUGGEST_TRIGGERS"


class Regime(str, Enum):
    MEAN_REVERSION = "MEAN_REVERSION"
    TREND = "TREND"
    NEUTRAL = "NEUTRAL"


class TriggerType(str, Enum):
    RATIO_BAND = "RATIO_BAND"
    STEP_LADDER = "STEP_LADDER"
    TREND_GUARDED_BAND = "TREND_GUARDED_BAND"


class PolicyViolation(BaseModel):
    code: str
    severity: str = Field(description="BLOCK or WARN")
    actual: float
    limit: float
    message: str = ""


class PolicyResult(BaseModel):
    passed: bool
    violations: list[PolicyViolation] = Field(default_factory=list)


class ExpectedMetrics(BaseModel):
    expected_edge_bps: float = Field(description="Expected edge in basis points after costs")
    cost_bps: float = Field(description="Total cost in bps")
    p_win: float = Field(description="Estimated probability of profitable rebalance")
    regime: Regime


class ReasonFactor(BaseModel):
    code: str = Field(description="Factor identifier, e.g. ZSCORE_HIGH")
    label: str = ""
    value: float = 0
    detail: str = ""


class TradeDetails(BaseModel):
    sell_token: str
    buy_token: str
    sell_amount: str = Field(description="Amount in human-readable units")
    sell_amount_raw: str = Field(default="", description="Amount in smallest units")
    min_buy_amount: str = ""
    slippage_bps: float = 0
    gas_usd: float = 0
    swap_target: str = ""
    swap_calldata: str = ""
    ttl_seconds: int = Field(default=60, description="Quote validity")


class TriggerSuggestion(BaseModel):
    type: TriggerType
    direction: str = Field(description="1to2 or 2to1")
    metric: str = Field(default="ratio", description="ratio or price")
    trigger_type: str = Field(description="gte or lte")
    value: float = Field(description="Trigger threshold")
    rebalance_pct: float = Field(description="Percent of balance to rebalance")
    label: str = Field(default="", description="Human-readable description")


class Explanation(BaseModel):
    short: str = Field(description="1-2 sentence summary")
    details: str = Field(default="", description="Structured explanation for UI")


class Recommendation(BaseModel):
    version: str = "1.0.0"
    pair: dict = Field(description="{ tokenA, tokenB, symbols }")
    chain_id: int = 8453
    timestamp: datetime = Field(default_factory=_utcnow)
    action: Action
    expected: ExpectedMetrics
    policy: PolicyResult
    reasons: list[ReasonFactor] = Field(default_factory=list)
    explain: Explanation
    trade: TradeDetails | None = Field(
        None, description="Present when action=REBALANCE_NOW"
    )
    triggers_suggestion: list[TriggerSuggestion] = Field(
        default_factory=list,
        description="Present when action=SUGGEST_TRIGGERS",
    )
    feature_version: str = "1.0.0"
    model_version: str = "mvp-heuristic"
    recommendation_id: str = ""
