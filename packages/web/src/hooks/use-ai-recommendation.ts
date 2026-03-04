"use client";

import { useState, useCallback } from "react";

export interface AiRecommendation {
  version: string;
  pair: { tokenA: string; tokenB: string; symbolA: string; symbolB: string };
  chain_id: number;
  timestamp: string;
  action: "HOLD" | "REBALANCE_NOW" | "SUGGEST_TRIGGERS";
  expected: {
    expected_edge_bps: number;
    cost_bps: number;
    p_win: number;
    regime: "MEAN_REVERSION" | "TREND" | "NEUTRAL";
  };
  policy: {
    passed: boolean;
    violations: Array<{
      code: string;
      severity: string;
      actual: number;
      limit: number;
      message: string;
    }>;
  };
  reasons: Array<{
    code: string;
    label: string;
    value: number;
    detail: string;
  }>;
  explain: {
    short: string;
    details: string;
  };
  trade?: {
    sell_token: string;
    buy_token: string;
    sell_amount: string;
    slippage_bps: number;
    gas_usd: number;
  };
  triggers_suggestion: Array<{
    type: string;
    direction: string;
    metric: string;
    trigger_type: string;
    value: number;
    rebalance_pct: number;
    label: string;
  }>;
  recommendation_id: string;
  model_version: string;
}

export function useAiRecommendation() {
  const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendation = useCallback(
    async (params: {
      chainId?: number;
      pairId?: string;
      tokenA: string;
      tokenB: string;
      symbolA?: string;
      symbolB?: string;
      userAddress?: string;
      vaultBalanceA?: number;
      vaultBalanceB?: number;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch("/api/ai/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chain_id: params.chainId || 8453,
            pair_id: params.pairId || "",
            pair: {
              token_a: params.tokenA,
              token_b: params.tokenB,
              symbol_a: params.symbolA || "",
              symbol_b: params.symbolB || "",
            },
            user_address: params.userAddress || "",
            portfolio_slice: {
              vault_balance_a: params.vaultBalanceA || 0,
              vault_balance_b: params.vaultBalanceB || 0,
            },
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text}`);
        }

        const data: AiRecommendation = await resp.json();
        setRecommendation(data);
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const createSuggestedTriggers = useCallback(
    async (
      rec: AiRecommendation,
      pairId: string,
      userAddress: string,
      fromToken: string,
      toToken: string,
      overridePct?: number
    ): Promise<{ created: string[]; errors: string[] }> => {
      const created: string[] = [];
      const errors: string[] = [];

      for (const trigger of rec.triggers_suggestion) {
        try {
          const pct = overridePct && overridePct > 0 && overridePct <= 100
            ? overridePct
            : trigger.rebalance_pct;

          const payload = {
            pairId,
            userAddress,
            direction: trigger.direction,
            metric: trigger.metric,
            type: trigger.trigger_type,
            value: trigger.value,
            fromToken: trigger.direction === "1to2" ? fromToken : toToken,
            toToken: trigger.direction === "1to2" ? toToken : fromToken,
            autoEnabled: true,
            amountMode: "percent",
            amount: Math.round(pct * 100) / 100,
          };

          console.log("[AI] Creating trigger:", payload);

          const resp = await fetch("/api/triggers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (resp.ok) {
            const data = await resp.json();
            created.push(data.id);
            console.log("[AI] Trigger created:", data.id);
          } else {
            const text = await resp.text();
            const errMsg = `HTTP ${resp.status}: ${text}`;
            errors.push(errMsg);
            console.error("[AI] Trigger creation failed:", errMsg);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push(errMsg);
          console.error("[AI] Trigger creation error:", errMsg);
        }
      }
      return { created, errors };
    },
    []
  );

  return {
    recommendation,
    loading,
    error,
    fetchRecommendation,
    createSuggestedTriggers,
    clearRecommendation: () => setRecommendation(null),
  };
}
