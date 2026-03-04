from datetime import datetime, timezone

from fastapi import APIRouter

from src.config import settings

router = APIRouter()

_start_time = datetime.now(timezone.utc)


@router.get("/ai/health")
async def health():
    uptime = (datetime.now(timezone.utc) - _start_time).total_seconds()
    return {
        "status": "ok",
        "service": "ai-advisor",
        "version": "0.1.0",
        "model_version": "mvp-heuristic",
        "feature_version": "1.0.0",
        "llm_enabled": settings.llm_enabled and bool(settings.openai_api_key),
        "chain_id": settings.chain_id,
        "uptime_seconds": round(uptime, 1),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
