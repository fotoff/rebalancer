import hashlib
import hmac
import time

from fastapi import HTTPException, Request, status
import structlog

from src.config import settings

logger = structlog.get_logger()

TIMESTAMP_TOLERANCE_SEC = 300


def _compute_signature(timestamp: str, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    return hmac.new(
        settings.service_secret.encode(), message, hashlib.sha256
    ).hexdigest()


async def verify_service_auth(request: Request) -> None:
    sig = request.headers.get("x-ai-signature")
    ts = request.headers.get("x-ai-timestamp")
    if not sig or not ts:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication headers",
        )

    try:
        req_time = int(ts)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid timestamp",
        )

    if abs(time.time() - req_time) > TIMESTAMP_TOLERANCE_SEC:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Request timestamp expired",
        )

    body = await request.body()
    expected = _compute_signature(ts, body)
    if not hmac.compare_digest(sig, expected):
        logger.warning("auth_failed", remote=request.client.host if request.client else "unknown")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature",
        )


def generate_signature(timestamp: int, body: bytes) -> str:
    """Utility for clients (Next.js) to generate auth headers."""
    return _compute_signature(str(timestamp), body)
