from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    model_config = {"env_prefix": "AI_", "env_file": ".env", "extra": "ignore"}

    # Service
    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = False
    log_level: str = "info"

    # Auth — shared secret between Next.js and ai-advisor
    service_secret: str = Field(description="HMAC shared secret for service auth")

    # External APIs (reuse existing project keys)
    nextjs_base_url: str = Field(
        default="http://127.0.0.1:3001", description="Next.js internal URL"
    )
    lifi_api_url: str = "https://li.quest/v1"
    dexscreener_api_url: str = "https://api.dexscreener.com"
    geckoterminal_api_url: str = "https://api.geckoterminal.com/api/v2"

    # LLM
    openai_api_key: str = Field(default="", description="OpenAI API key for explanations")
    llm_model: str = "gpt-4o-mini"
    llm_enabled: bool = True

    # Chain
    chain_id: int = 8453
    vault_address: str = ""

    # Social data
    social_enabled: bool = True

    # Snapshot cache TTL (seconds)
    snapshot_cache_ttl: int = 15

    # Policy defaults
    max_slippage_bps: int = 100
    max_gas_usd: float = 10.0
    min_liquidity_score: float = 0.1
    min_edge_after_cost_bps: float = 10.0
    max_trade_pct: float = 30.0
    cooldown_minutes: int = 60
    max_daily_turnover_pct: float = 200.0
    data_staleness_seconds: int = 120


settings = Settings()
