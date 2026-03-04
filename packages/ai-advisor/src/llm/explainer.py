"""LLM explainer: generates human-readable explanations via OpenAI (or fallback)."""

from __future__ import annotations

import structlog
from openai import AsyncOpenAI

from src.config import settings
from src.llm.templates import build_template_explanation
from src.models.features import FeatureVector
from src.models.recommendation import (
    Action,
    Explanation,
    PolicyResult,
    Regime,
    ReasonFactor,
)

logger = structlog.get_logger()

SYSTEM_PROMPT = """You are an AI advisor for a DeFi token rebalancer on Base chain.
Your role is to explain trading recommendations in clear, concise English.
You receive computed metrics and a decision — you ONLY explain, never override the decision.

The core logic: when two tokens in a pair diverge in price (one rises, the other stays flat 
or falls), it may be time to rebalance — sell some of the outperformer, buy the underperformer.

Rules:
- Write in English
- Be concise: "short" = 1-2 sentences, "details" = structured text with key metrics
- Never invent numbers — only use the provided data
- Never suggest a different action than what was decided
- Focus on price divergence between tokens as the main signal
- Explain which token outperformed and by how much
- Mention social sentiment if available
- Mention risks and costs alongside potential benefits

Output format (JSON):
{"short": "...", "details": "..."}"""


async def generate_explanation(
    action: Action,
    regime: Regime,
    features: FeatureVector,
    policy: PolicyResult,
    reasons: list[ReasonFactor],
    expected_edge_bps: float,
    cost_bps: float,
    symbol_a: str = "A",
    symbol_b: str = "B",
) -> Explanation:
    """Generate explanation via LLM or fallback to templates."""
    if not settings.llm_enabled or not settings.openai_api_key:
        return build_template_explanation(
            action, regime, features, policy, expected_edge_bps, cost_bps, symbol_a, symbol_b
        )

    try:
        return await _call_llm(
            action, regime, features, policy, reasons,
            expected_edge_bps, cost_bps, symbol_a, symbol_b,
        )
    except Exception as e:
        logger.error("llm_failed_fallback_to_template", error=str(e))
        return build_template_explanation(
            action, regime, features, policy, expected_edge_bps, cost_bps, symbol_a, symbol_b
        )


async def _call_llm(
    action: Action,
    regime: Regime,
    features: FeatureVector,
    policy: PolicyResult,
    reasons: list[ReasonFactor],
    expected_edge_bps: float,
    cost_bps: float,
    symbol_a: str,
    symbol_b: str,
) -> Explanation:
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    user_msg = _build_user_prompt(
        action, regime, features, policy, reasons,
        expected_edge_bps, cost_bps, symbol_a, symbol_b,
    )

    response = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=500,
    )

    import json
    content = response.choices[0].message.content or "{}"
    data = json.loads(content)

    return Explanation(
        short=data.get("short", f"{symbol_a}/{symbol_b}: {action.value}"),
        details=data.get("details", ""),
    )


def _build_user_prompt(
    action: Action,
    regime: Regime,
    features: FeatureVector,
    policy: PolicyResult,
    reasons: list[ReasonFactor],
    edge_bps: float,
    cost_bps: float,
    sym_a: str,
    sym_b: str,
) -> str:
    parts = [
        f"Pair: {sym_a}/{sym_b}",
        f"Action: {action.value}",
        f"Regime: {regime.value}",
        f"Ratio: {features.ratio:.6f}",
    ]
    if features.price_change_a_24h is not None:
        parts.append(f"{sym_a} price change 24h: {features.price_change_a_24h:+.2f}%")
    if features.price_change_b_24h is not None:
        parts.append(f"{sym_b} price change 24h: {features.price_change_b_24h:+.2f}%")
    if features.divergence_24h is not None:
        parts.append(f"Price divergence 24h: {features.divergence_24h:+.2f}%")
    if features.divergence_7d is not None:
        parts.append(f"Price divergence 7d: {features.divergence_7d:+.2f}%")
    if features.outperformer:
        parts.append(f"Outperformer: {sym_a if features.outperformer == 'A' else sym_b}")
    if features.trend_a_7d is not None:
        parts.append(f"7d trend: {sym_a} {features.trend_a_7d:+.1f}%, {sym_b} {features.trend_b_7d:+.1f}%")
    if features.sentiment_a is not None:
        parts.append(f"Social sentiment: {sym_a}={features.sentiment_a:+.2f}")
    if features.sentiment_b is not None:
        parts.append(f"Social sentiment: {sym_b}={features.sentiment_b:+.2f}")
    parts.append(f"Expected edge: {edge_bps:.1f} bps")
    parts.append(f"Cost: {cost_bps:.1f} bps")
    parts.append(f"Policy passed: {policy.passed}")
    if policy.violations:
        v_strs = [f"{v.code}({v.severity}): {v.message}" for v in policy.violations]
        parts.append(f"Violations: {'; '.join(v_strs)}")
    if reasons:
        r_strs = [f"{r.code}={r.value:.3f}" for r in reasons if r.value != 0]
        parts.append(f"Reasons: {', '.join(r_strs)}")

    return "\n".join(parts)
