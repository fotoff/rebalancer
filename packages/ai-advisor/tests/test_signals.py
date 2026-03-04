"""Tests for signal engine."""

import pytest

from src.models.features import FeatureVector
from src.models.recommendation import Action, Regime
from src.signals.regime import classify_regime
from src.signals.sizing import compute_rebalance_pct
from src.signals.engine import compute_signal


class TestRegime:
    def test_neutral_no_zscore(self):
        fv = FeatureVector(ratio=2.0, log_ratio=0.69)
        assert classify_regime(fv) == Regime.NEUTRAL

    def test_mean_reversion_high_zscore(self):
        fv = FeatureVector(ratio=2.0, log_ratio=0.69, zscore_24h=2.0)
        assert classify_regime(fv) == Regime.MEAN_REVERSION

    def test_trend_strong_momentum(self):
        fv = FeatureVector(
            ratio=2.0, log_ratio=0.69, zscore_24h=0.5, return_ratio_1d=0.05
        )
        assert classify_regime(fv) == Regime.TREND

    def test_trend_overrides_mean_reversion_on_momentum(self):
        # High zscore but momentum in same direction
        fv = FeatureVector(
            ratio=2.0, log_ratio=0.69, zscore_24h=2.0, return_ratio_1d=0.05
        )
        assert classify_regime(fv) == Regime.TREND


class TestSizing:
    def test_basic_sizing(self):
        pct = compute_rebalance_pct(2.0)
        assert 5.0 <= pct <= 50.0

    def test_min_clamp(self):
        pct = compute_rebalance_pct(0.1)
        assert pct == 5.0

    def test_max_clamp(self):
        pct = compute_rebalance_pct(10.0)
        assert pct == 50.0

    def test_user_constraint(self):
        pct = compute_rebalance_pct(5.0, max_trade_pct=15.0)
        assert pct <= 15.0


class TestSignalEngine:
    def test_hold_neutral(self):
        fv = FeatureVector(ratio=2.0, log_ratio=0.69)
        signal = compute_signal(fv)
        assert signal.action == Action.HOLD

    def test_suggest_triggers_on_zscore(self):
        fv = FeatureVector(
            ratio=2.0,
            log_ratio=0.69,
            zscore_24h=1.8,
            realized_vol_24h=0.5,
            cost_bps=5.0,
        )
        signal = compute_signal(fv, symbol_a="AAA", symbol_b="BBB")
        assert signal.action in (Action.SUGGEST_TRIGGERS, Action.REBALANCE_NOW)
        assert len(signal.triggers) > 0

    def test_rebalance_now_extreme_zscore(self):
        fv = FeatureVector(
            ratio=2.0,
            log_ratio=0.69,
            zscore_24h=3.0,
            realized_vol_24h=0.8,
            cost_bps=5.0,
        )
        signal = compute_signal(fv, symbol_a="AAA", symbol_b="BBB")
        assert signal.action == Action.REBALANCE_NOW
        assert signal.rebalance_pct > 0

    def test_hold_when_cost_exceeds_edge(self):
        fv = FeatureVector(
            ratio=2.0,
            log_ratio=0.69,
            zscore_24h=1.6,
            realized_vol_24h=0.01,
            cost_bps=100.0,
        )
        signal = compute_signal(fv)
        assert signal.action == Action.HOLD

    def test_reasons_present(self):
        fv = FeatureVector(
            ratio=2.0, log_ratio=0.69, zscore_24h=2.0, realized_vol_24h=0.3
        )
        signal = compute_signal(fv)
        assert len(signal.reasons) > 0
        codes = [r.code for r in signal.reasons]
        assert "ZSCORE" in codes
        assert "REGIME" in codes
