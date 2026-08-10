"use client";

import { useQuery } from "@tanstack/react-query";

export type PairStats = {
  n_obs: number;
  beta: number;
  spread_zscore: number;
  half_life_bars: number | null;
  adf_pvalue: number | null;
  is_cointegrated: boolean;
  hurst: number | null;
  correlation: number;
  regime: "MEAN_REVERSION" | "TREND" | "NEUTRAL";
};

export type BacktestResult = {
  bars: number;
  strategy_return_pct: number;
  hodl_return_pct: number;
  excess_return_pct: number;
  rebalance_count: number;
  total_cost_pct: number;
  max_drawdown_pct: number;
  sharpe: number | null;
  final_weight_a: number;
  verdict: "BEATS_HODL" | "UNDERPERFORMS" | "INCONCLUSIVE";
};

export type PairAnalysis = {
  ok: boolean;
  reason?: string;
  bars?: number;
  timeframe?: string;
  stats: PairStats | null;
  backtest: BacktestResult | null;
};

/**
 * Statistical analysis + backtest for a pair, computed on real OHLCV history.
 * Enabled explicitly so opening a pair doesn't fire an expensive analysis until
 * the user asks for it.
 */
export function usePairAnalysis(
  token1: string,
  token2: string,
  opts: { thresholdPct?: number; enabled?: boolean } = {}
) {
  const { thresholdPct = 5, enabled = false } = opts;

  return useQuery<PairAnalysis>({
    queryKey: ["pair-analysis", token1.toLowerCase(), token2.toLowerCase(), thresholdPct],
    queryFn: async () => {
      const res = await fetch("/api/ai/analyze-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenA: token1,
          tokenB: token2,
          thresholdPct,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PairAnalysis;
    },
    enabled: enabled && Boolean(token1 && token2),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
