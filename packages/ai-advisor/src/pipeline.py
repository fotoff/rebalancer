"""Main recommendation pipeline: Snapshot → Features → Signal → Policy → LLM → Output."""

from __future__ import annotations

import httpx
import structlog

from src.features.calculator import compute_features
from src.llm.explainer import generate_explanation
from src.models.recommendation import Recommendation
from src.models.request import RecommendRequest
from src.output.builder import build_recommendation, _hold_fallback
from src.policy.engine import evaluate_policy
from src.signals.engine import compute_signal
from src.snapshot.builder import build_snapshot
from src.snapshot.cache import cache_key, get_cached, set_cached

logger = structlog.get_logger()


async def run_recommendation_pipeline(
    client: httpx.AsyncClient,
    request: RecommendRequest,
) -> Recommendation:
    """Execute the full recommendation pipeline."""
    pair = request.pair
    sym_a = pair.symbol_a or pair.token_a[:8]
    sym_b = pair.symbol_b or pair.token_b[:8]

    try:
        # 1. Build snapshot (with cache)
        ck = cache_key(pair.token_a, pair.token_b)
        snapshot = get_cached(ck)
        if snapshot is None:
            portfolio = request.portfolio_slice or {}
            snapshot = await build_snapshot(
                client,
                pair=pair,
                pair_id=request.pair_id,
                user_address=request.user_address,
                vault_balance_a=portfolio.get("vault_balance_a"),
                vault_balance_b=portfolio.get("vault_balance_b"),
                fetch_quote_for_amount=portfolio.get("quote_amount_raw"),
            )
            set_cached(ck, snapshot)

        # 2. Compute features (divergence-based)
        features = compute_features(snapshot)
        logger.info(
            "features_computed",
            ratio=features.ratio,
            div_1h=features.divergence_1h,
            div_24h=features.divergence_24h,
            div_7d=features.divergence_7d,
            outperformer=features.outperformer,
            change_a_24h=features.price_change_a_24h,
            change_b_24h=features.price_change_b_24h,
            has_social=features.has_social,
        )

        # 3. Signal engine
        signal = compute_signal(
            features, request.user_constraints, sym_a, sym_b
        )

        # 4. Policy engine
        policy = evaluate_policy(
            features=features,
            snapshot=snapshot,
            expected_edge_bps=signal.expected_edge_bps,
            rebalance_pct=signal.rebalance_pct,
            constraints=request.user_constraints,
        )

        # 5. LLM explanation
        explanation = await generate_explanation(
            action=signal.action,
            regime=signal.regime,
            features=features,
            policy=policy,
            reasons=signal.reasons,
            expected_edge_bps=signal.expected_edge_bps,
            cost_bps=signal.cost_bps,
            symbol_a=sym_a,
            symbol_b=sym_b,
        )

        # 6. Build output
        recommendation = build_recommendation(
            signal=signal,
            features=features,
            policy=policy,
            explanation=explanation,
            token_a=pair.token_a,
            token_b=pair.token_b,
            symbol_a=sym_a,
            symbol_b=sym_b,
            chain_id=request.chain_id,
        )

        logger.info(
            "recommendation_built",
            action=recommendation.action.value,
            edge=recommendation.expected.expected_edge_bps,
            policy_passed=recommendation.policy.passed,
            rec_id=recommendation.recommendation_id,
        )

        return recommendation

    except Exception as e:
        logger.error("pipeline_error", error=str(e), pair=f"{sym_a}/{sym_b}")
        return _hold_fallback(
            pair.token_a, pair.token_b, sym_a, sym_b,
            request.chain_id, str(e),
        )
