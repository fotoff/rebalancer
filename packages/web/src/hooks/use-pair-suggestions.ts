"use client";

import { useState, useCallback } from "react";

export interface SuggestedPair {
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  score: number;
  divergence_1h: number | null;
  divergence_6h: number | null;
  divergence_24h: number | null;
  abs_divergence_max: number;
  regime: "MEAN_REVERSION" | "TREND" | "NEUTRAL";
  action: "HOLD" | "REBALANCE_NOW" | "SUGGEST_TRIGGERS";
  expected_edge_bps: number;
  price_change_a_24h: number | null;
  price_change_b_24h: number | null;
  rationale: string;
}

export function usePairSuggestions() {
  const [suggestions, setSuggestions] = useState<SuggestedPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(
    async (params: {
      holdings: Array<{
        token: string;
        symbol: string;
        balance: number;
        usdValue: number;
      }>;
      userAddress?: string;
      excludeTokens?: string[];
    }) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch("/api/ai/suggest-pairs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chain_id: 8453,
            user_address: params.userAddress || "",
            holdings: params.holdings.map((h) => ({
              token: h.token,
              symbol: h.symbol,
              balance: h.balance,
              usd_value: h.usdValue,
            })),
            min_balance_usd: 5,
            exclude_tokens: params.excludeTokens || [],
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text}`);
        }

        const data = await resp.json();
        const pairs: SuggestedPair[] = data.pairs ?? [];
        setSuggestions(pairs);
        return pairs;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    suggestions,
    loading,
    error,
    fetchSuggestions,
    clearSuggestions: () => setSuggestions([]),
  };
}
