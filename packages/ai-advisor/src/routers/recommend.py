"""POST /ai/recommend — get recommendation for a token pair."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from src.auth import verify_service_auth
from src.models.request import RecommendRequest
from src.pipeline import run_recommendation_pipeline

router = APIRouter()


@router.post("/ai/recommend", dependencies=[Depends(verify_service_auth)])
async def recommend(req: RecommendRequest, request: Request):
    client = request.app.state.http_client
    recommendation = await run_recommendation_pipeline(client, req)
    return recommendation.model_dump(mode="json")
