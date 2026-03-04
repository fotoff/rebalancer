from contextlib import asynccontextmanager

import httpx
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.logging_config import setup_logging
from src.routers import health, recommend, suggest_pairs, validate

setup_logging(settings.log_level)
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
    logger.info(
        "ai_advisor_started",
        host=settings.host,
        port=settings.port,
        chain_id=settings.chain_id,
        llm_enabled=settings.llm_enabled,
    )
    yield
    await app.state.http_client.aclose()
    logger.info("ai_advisor_stopped")


app = FastAPI(
    title="AI Advisor — Token Rebalancer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3001", "http://localhost:3001"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(recommend.router)
app.include_router(suggest_pairs.router)
app.include_router(validate.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
