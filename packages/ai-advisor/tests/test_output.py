"""Tests for output builder and recommendation model."""

import pytest
from datetime import datetime, timezone

from src.models.recommendation import (
    Action,
    Explanation,
    ExpectedMetrics,
    PolicyResult,
    Recommendation,
    Regime,
)
from src.models.features import FeatureVector
from src.output.builder import build_recommendation, _hold_fallback
from src.signals.engine import SignalResult


class TestOutputBuilder:
    def test_builds_valid_recommendation(self):
        signal = SignalResult()
        signal.action = Action.SUGGEST_TRIGGERS
        signal.regime = Regime.MEAN_REVERSION
        signal.expected_edge_bps = 45.0
        signal.cost_bps = 15.0
        signal.p_win = 0.62
        signal.rebalance_pct = 25.0
        signal.sell_direction = "1to2"

        fv = FeatureVector(ratio=2.0, log_ratio=0.69)
        policy = PolicyResult(passed=True, violations=[])
        explain = Explanation(short="Test short", details="Test details")

        rec = build_recommendation(
            signal=signal,
            features=fv,
            policy=policy,
            explanation=explain,
            token_a="0xaaa",
            token_b="0xbbb",
            symbol_a="AAA",
            symbol_b="BBB",
        )

        assert rec.action == Action.SUGGEST_TRIGGERS
        assert rec.expected.expected_edge_bps == 45.0
        assert rec.recommendation_id != ""
        assert rec.version == "1.0.0"

    def test_policy_block_overrides_to_hold(self):
        signal = SignalResult()
        signal.action = Action.REBALANCE_NOW
        signal.regime = Regime.MEAN_REVERSION
        signal.expected_edge_bps = 45.0
        signal.cost_bps = 15.0
        signal.p_win = 0.62

        fv = FeatureVector(ratio=2.0, log_ratio=0.69)
        policy = PolicyResult(passed=False, violations=[])
        explain = Explanation(short="Blocked", details="")

        rec = build_recommendation(
            signal=signal,
            features=fv,
            policy=policy,
            explanation=explain,
            token_a="0xaaa",
            token_b="0xbbb",
        )

        assert rec.action == Action.HOLD

    def test_hold_fallback(self):
        rec = _hold_fallback("0xa", "0xb", "A", "B", 8453, "test error")
        assert rec.action == Action.HOLD
        assert "test error" in rec.explain.details


class TestRecommendationModel:
    def test_json_serialization(self):
        rec = Recommendation(
            version="1.0.0",
            pair={"tokenA": "0xa", "tokenB": "0xb"},
            action=Action.HOLD,
            expected=ExpectedMetrics(
                expected_edge_bps=0,
                cost_bps=0,
                p_win=0.5,
                regime=Regime.NEUTRAL,
            ),
            policy=PolicyResult(passed=True, violations=[]),
            explain=Explanation(short="OK", details=""),
        )
        data = rec.model_dump(mode="json")
        assert data["action"] == "HOLD"
        assert data["expected"]["regime"] == "NEUTRAL"
        assert isinstance(data["timestamp"], str)
