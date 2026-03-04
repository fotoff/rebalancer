from __future__ import annotations

from pydantic import BaseModel, Field


class PairSpec(BaseModel):
    token_a: str = Field(description="Token A contract address")
    token_b: str = Field(description="Token B contract address")
    symbol_a: str = ""
    symbol_b: str = ""


class UserConstraints(BaseModel):
    max_slippage_bps: int | None = None
    max_gas_usd: float | None = None
    max_trade_pct: float | None = Field(
        None, description="Max % of vault balance to trade"
    )
    min_edge_bps: float | None = None
    cooldown_minutes: int | None = None
    denylist: list[str] = Field(default_factory=list, description="Denied token addresses")


class RecommendRequest(BaseModel):
    chain_id: int = 8453
    pair: PairSpec
    user_address: str = ""
    pair_id: str = ""
    user_constraints: UserConstraints = Field(default_factory=UserConstraints)
    portfolio_slice: dict | None = Field(
        None,
        description="{ vault_balance_a, vault_balance_b } for sizing",
    )


class Holding(BaseModel):
    token: str = Field(description="Token contract address")
    symbol: str = ""
    balance: float = 0
    usd_value: float = 0


class SuggestPairsRequest(BaseModel):
    chain_id: int = 8453
    user_address: str = ""
    holdings: list[Holding] = Field(default_factory=list)
    min_liquidity_usd: float = 1000
    min_balance_usd: float = 10
    exclude_tokens: list[str] = Field(default_factory=list)


class ValidateRequest(BaseModel):
    recommendation_id: str = ""
    chain_id: int = 8453
    pair: PairSpec | None = None
    trade: dict | None = None
    current_balances: dict | None = None
    max_slippage_bps: int | None = None
