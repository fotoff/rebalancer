"""Volatility features: realized vol and ATR proxy."""

from __future__ import annotations

import math

import numpy as np


def compute_volatility(closes_ratio: list[float]) -> dict:
    """Compute realized volatility and ATR-like range from ratio closes.

    Returns annualized volatility (assuming daily bars * sqrt(365)).
    """
    result: dict[str, float | None] = {
        "realized_vol_24h": None,
        "realized_vol_72h": None,
        "atr_proxy_24h": None,
    }

    if len(closes_ratio) < 2:
        return result

    log_returns = []
    for i in range(1, len(closes_ratio)):
        if closes_ratio[i] > 0 and closes_ratio[i - 1] > 0:
            log_returns.append(math.log(closes_ratio[i] / closes_ratio[i - 1]))

    if not log_returns:
        return result

    annualization = math.sqrt(365)

    # 24h vol (last 24 bars or all available)
    window_24 = log_returns[-24:] if len(log_returns) >= 24 else log_returns
    if len(window_24) >= 2:
        result["realized_vol_24h"] = float(np.std(window_24, ddof=1)) * annualization

    # 72h vol
    window_72 = log_returns[-72:] if len(log_returns) >= 72 else log_returns
    if len(window_72) >= 2:
        result["realized_vol_72h"] = float(np.std(window_72, ddof=1)) * annualization

    # ATR proxy: average of |log_return| over last 24 bars, annualized
    abs_returns_24 = [abs(r) for r in window_24]
    if abs_returns_24:
        result["atr_proxy_24h"] = float(np.mean(abs_returns_24)) * annualization

    return result
