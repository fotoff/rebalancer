"""Tests for policy engine."""

import pytest
from datetime import datetime, timezone, timedelta

from src.models.features import FeatureVector
from src.models.snapshot import Snapshot, MarketSnapshot, TokenPrice, QuoteSnapshot
from src.policy.rules import (
    check_max_slippage,
    check_max_gas,
    check_min_liquidity,
    check_min_edge,
    check_max_trade_pct,
    check_cooldown,
    check_data_staleness,
    check_token_denylist,
)
from src.policy.engine import evaluate_policy


class TestPolicyRules:
    def test_slippage_ok(self):
        assert check_max_slippage(50.0, 100) is None

    def test_slippage_block(self):
        v = check_max_slippage(150.0, 100)
        assert v is not None
        assert v.severity == "BLOCK"

    def test_slippage_warn(self):
        v = check_max_slippage(75.0, 100)
        assert v is not None
        assert v.severity == "WARN"

    def test_gas_ok(self):
        assert check_max_gas(3.0, 10.0) is None

    def test_gas_block(self):
        v = check_max_gas(15.0, 10.0)
        assert v is not None
        assert v.severity == "BLOCK"

    def test_liquidity_ok(self):
        assert check_min_liquidity(0.5, 0.1) is None

    def test_liquidity_block(self):
        v = check_min_liquidity(0.05, 0.1)
        assert v is not None
        assert v.severity == "BLOCK"

    def test_edge_positive(self):
        assert check_min_edge(20.0, 10.0) is None

    def test_edge_negative_block(self):
        v = check_min_edge(-5.0, 10.0)
        assert v is not None
        assert v.severity == "BLOCK"

    def test_edge_low_warn(self):
        v = check_min_edge(5.0, 10.0)
        assert v is not None
        assert v.severity == "WARN"

    def test_trade_pct_ok(self):
        assert check_max_trade_pct(20.0, 30.0) is None

    def test_trade_pct_block(self):
        v = check_max_trade_pct(40.0, 30.0)
        assert v is not None
        assert v.severity == "BLOCK"

    def test_cooldown_ok(self):
        old = datetime.now(timezone.utc) - timedelta(hours=2)
        assert check_cooldown(old, 60) is None

    def test_cooldown_block(self):
        recent = datetime.now(timezone.utc) - timedelta(minutes=5)
        v = check_cooldown(recent, 60)
        assert v is not None
        assert v.severity == "BLOCK"

    def test_staleness_ok(self):
        now = datetime.now(timezone.utc)
        assert check_data_staleness(now, 120) is None

    def test_staleness_block(self):
        old = datetime.now(timezone.utc) - timedelta(minutes=5)
        v = check_data_staleness(old, 120)
        assert v is not None
        assert v.severity == "BLOCK"

    def test_denylist_ok(self):
        assert check_token_denylist("0xaaa", "0xbbb", []) is None

    def test_denylist_block(self):
        v = check_token_denylist("0xaaa", "0xbbb", ["0xAAA"])
        assert v is not None
        assert v.severity == "BLOCK"


class TestPolicyEngine:
    def test_passes_clean(self, sample_snapshot):
        fv = FeatureVector(
            ratio=2.0,
            log_ratio=0.69,
            slippage_bps=10.0,
            gas_usd=0.5,
            liquidity_score=0.9,
        )
        result = evaluate_policy(
            features=fv,
            snapshot=sample_snapshot,
            expected_edge_bps=50.0,
            rebalance_pct=20.0,
        )
        assert result.passed is True

    def test_blocks_high_slippage(self, sample_snapshot):
        fv = FeatureVector(
            ratio=2.0,
            log_ratio=0.69,
            slippage_bps=200.0,
            gas_usd=0.5,
            liquidity_score=0.9,
        )
        result = evaluate_policy(
            features=fv,
            snapshot=sample_snapshot,
            expected_edge_bps=50.0,
            rebalance_pct=20.0,
        )
        assert result.passed is False
        assert any(v.code == "MAX_SLIPPAGE_BPS" for v in result.violations)
