"""Tests for feature calculation modules."""

import math
import pytest

from src.features.ratio import compute_ratio_features
from src.features.momentum import compute_momentum, _return_over_n
from src.features.mean_reversion import compute_zscore
from src.features.volatility import compute_volatility
from src.features.correlation import compute_correlation
from src.features.cost import compute_cost_features
from src.features.calculator import compute_features


class TestRatio:
    def test_basic_ratio(self):
        r = compute_ratio_features(100.0, 50.0)
        assert r["ratio"] == pytest.approx(2.0)
        assert r["log_ratio"] == pytest.approx(math.log(2))

    def test_zero_price_b(self):
        r = compute_ratio_features(100.0, 0.0)
        assert r["ratio"] == 0.0
        assert r["log_ratio"] == 0.0

    def test_equal_prices(self):
        r = compute_ratio_features(42.0, 42.0)
        assert r["ratio"] == pytest.approx(1.0)
        assert r["log_ratio"] == pytest.approx(0.0, abs=1e-10)


class TestMomentum:
    def test_return_over_n(self):
        closes = [100, 110, 120]
        assert _return_over_n(closes, 1) == pytest.approx(120 / 110 - 1)

    def test_insufficient_data(self):
        assert _return_over_n([100], 1) is None

    def test_compute_momentum_basic(self):
        closes = [10.0, 11.0, 12.0, 11.5]
        result = compute_momentum(closes, closes, closes)
        assert "return_ratio_1d" in result
        assert result["return_ratio_1d"] is not None


class TestZscore:
    def test_zscore_centered(self):
        # Constant series → zscore should be ~0
        closes = [100.0] * 30
        z = compute_zscore(closes, window=24)
        assert z == pytest.approx(0.0, abs=0.01)

    def test_zscore_deviation(self):
        # Series with last value much higher
        closes = [100.0] * 29 + [150.0]
        z = compute_zscore(closes, window=24)
        assert z is not None
        assert z > 2.0  # significant deviation

    def test_zscore_insufficient_data(self):
        z = compute_zscore([100.0] * 10, window=24)
        assert z is None


class TestVolatility:
    def test_constant_series(self):
        vol = compute_volatility([100.0] * 30)
        assert vol["realized_vol_24h"] == pytest.approx(0.0, abs=1e-10)

    def test_volatile_series(self):
        closes = [100.0, 105.0, 95.0, 110.0, 90.0] * 6
        vol = compute_volatility(closes)
        assert vol["realized_vol_24h"] is not None
        assert vol["realized_vol_24h"] > 0

    def test_empty_series(self):
        vol = compute_volatility([])
        assert vol["realized_vol_24h"] is None


class TestCorrelation:
    def test_perfect_correlation(self):
        a = [100, 110, 120, 130, 140]
        b = [50, 55, 60, 65, 70]
        corr = compute_correlation(a, b)
        assert corr is not None
        assert corr > 0.99

    def test_negative_correlation(self):
        # Alternating pattern to get negative correlation of returns
        a = [100, 110, 100, 110, 100, 110]
        b = [100, 90, 100, 90, 100, 90]
        corr = compute_correlation(a, b)
        assert corr is not None
        assert corr < -0.9

    def test_insufficient_data(self):
        assert compute_correlation([100], [50]) is None


class TestCost:
    def test_with_quote(self, sample_quote):
        result = compute_cost_features(sample_quote, price_a_usd=100.0)
        assert result["cost_bps"] is not None
        assert result["cost_bps"] > 0
        assert result["slippage_bps"] == pytest.approx(10.0)
        assert result["liquidity_score"] is not None

    def test_without_quote(self):
        result = compute_cost_features(None)
        assert result["cost_bps"] is None
        assert result["liquidity_score"] is None


class TestFeatureCalculator:
    def test_full_pipeline(self, sample_snapshot):
        fv = compute_features(sample_snapshot)
        assert fv.ratio > 0
        assert fv.log_ratio != 0
        assert fv.version == "1.0.0"
        assert fv.bars_available > 0
