"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import {
  useAiRecommendation,
  type AiRecommendation,
} from "@/hooks/use-ai-recommendation";

type AiAdvisorProps = {
  token1: string;
  token2: string;
  sym1: string;
  sym2: string;
  pairId: string;
  vaultBal1: number;
  vaultBal2: number;
  onTriggersCreated?: () => void;
};

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  HOLD: { label: "Hold", color: "text-white/60", bg: "bg-white/10" },
  REBALANCE_NOW: { label: "Rebalance now", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  SUGGEST_TRIGGERS: { label: "Create triggers", color: "text-blue-400", bg: "bg-blue-500/10" },
};

const REGIME_LABELS: Record<string, string> = {
  MEAN_REVERSION: "Mean Reversion",
  TREND: "Trend",
  NEUTRAL: "Neutral",
};

export function AiAdvisor({
  token1,
  token2,
  sym1,
  sym2,
  pairId,
  vaultBal1,
  vaultBal2,
  onTriggersCreated,
}: AiAdvisorProps) {
  const { address } = useAccount();
  const {
    recommendation,
    loading,
    error,
    fetchRecommendation,
    createSuggestedTriggers,
  } = useAiRecommendation();

  const [creatingTriggers, setCreatingTriggers] = useState(false);
  const [triggersCreated, setTriggersCreated] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [rebalancePct, setRebalancePct] = useState<string>("");

  const handleGetRecommendation = () => {
    setTriggersCreated(false);
    setTriggerError(null);
    setRebalancePct("");
    fetchRecommendation({
      tokenA: token1,
      tokenB: token2,
      symbolA: sym1,
      symbolB: sym2,
      pairId,
      userAddress: address || "",
      vaultBalanceA: vaultBal1,
      vaultBalanceB: vaultBal2,
    });
  };

  const handleCreateTriggers = async () => {
    if (!recommendation || !address) {
      setTriggerError("Wallet not connected");
      return;
    }
    setCreatingTriggers(true);
    setTriggerError(null);

    const overridePct = rebalancePct ? parseFloat(rebalancePct) : undefined;

    try {
      const result = await createSuggestedTriggers(
        recommendation,
        pairId,
        address,
        token1,
        token2,
        overridePct
      );
      if (result.created.length > 0) {
        setTriggersCreated(true);
        onTriggersCreated?.();
      }
      if (result.errors.length > 0) {
        setTriggerError(result.errors[0]);
      }
      if (result.created.length === 0 && result.errors.length === 0) {
        setTriggerError("No triggers to create");
      }
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreatingTriggers(false);
    }
  };

  const rec = recommendation;
  const actionInfo = rec ? ACTION_LABELS[rec.action] || ACTION_LABELS.HOLD : null;

  const defaultPct =
    rec?.triggers_suggestion?.[0]?.rebalance_pct ??
    rec?.triggers_suggestion?.[1]?.rebalance_pct ??
    5;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      {/* Header */}
      <h3 className="mb-1 text-lg font-bold text-white">AI Advisor</h3>

      {/* Refresh / Get recommendation button */}
      <button
        onClick={handleGetRecommendation}
        disabled={loading}
        className="mb-4 rounded-lg bg-[#0052FF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0046e0] disabled:opacity-50"
      >
        {loading ? "Analyzing..." : rec ? "Refresh" : "Get recommendation"}
      </button>

      {error && (
        <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {!rec && !loading && !error && (
        <p className="text-sm text-white/40">
          Click &quot;Get recommendation&quot; for AI analysis of {sym1}/{sym2}
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          Analyzing {sym1}/{sym2}...
        </div>
      )}

      {rec && !loading && (
        <div className="space-y-3">
          {/* Action badge + regime */}
          <div className="flex items-center gap-3">
            <span
              className={`rounded-lg px-3 py-1 text-sm font-medium ${actionInfo?.bg} ${actionInfo?.color}`}
            >
              {actionInfo?.label}
            </span>
            <span className="text-xs text-white/40">
              {REGIME_LABELS[rec.expected.regime] || rec.expected.regime}
            </span>
          </div>

          {/* Short explanation */}
          <p className="text-sm text-white/80">{rec.explain.short}</p>

          {/* Key metrics */}
          <div className="flex flex-wrap gap-3 text-xs">
            <MetricBadge
              label="Edge"
              value={`${rec.expected.expected_edge_bps >= 0 ? "+" : ""}${rec.expected.expected_edge_bps.toFixed(0)} bps`}
              positive={rec.expected.expected_edge_bps > 0}
            />
            <MetricBadge
              label="Cost"
              value={`${rec.expected.cost_bps.toFixed(0)} bps`}
            />
            <MetricBadge
              label="pWin"
              value={`${(rec.expected.p_win * 100).toFixed(0)}%`}
              positive={rec.expected.p_win >= 0.55}
            />
          </div>

          {/* Policy warnings/blocks */}
          {rec.policy.violations.length > 0 && (
            <div className="space-y-1">
              {rec.policy.violations.map((v, i) => (
                <div
                  key={i}
                  className={`rounded px-2 py-1 text-xs ${
                    v.severity === "BLOCK"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-yellow-500/10 text-yellow-400"
                  }`}
                >
                  {v.severity === "BLOCK" ? "⛔" : "⚠️"} {v.message}
                </div>
              ))}
            </div>
          )}

          {/* Trigger suggestions */}
          {(rec.action === "SUGGEST_TRIGGERS" || rec.action === "REBALANCE_NOW") &&
            rec.triggers_suggestion.length > 0 && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                <p className="mb-2 text-sm font-medium text-blue-400">
                  Suggested triggers:
                </p>
                {rec.triggers_suggestion.map((t, i) => (
                  <div key={i} className="mb-1 text-sm text-white/70">
                    • {t.label || `${t.type}: ${t.trigger_type} ${t.value.toFixed(4)}, ${t.rebalance_pct}%`}
                  </div>
                ))}

                {/* Create triggers row: input + button */}
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={handleCreateTriggers}
                    disabled={creatingTriggers || triggersCreated}
                    className="rounded-lg bg-[#0052FF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0046e0] disabled:opacity-50"
                  >
                    {triggersCreated
                      ? "✓ Triggers created"
                      : creatingTriggers
                        ? "Creating..."
                        : "Create triggers"}
                  </button>

                  {/* Editable rebalance % */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      placeholder={String(defaultPct)}
                      value={rebalancePct}
                      onChange={(e) => setRebalancePct(e.target.value)}
                      className="w-16 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-center text-sm text-white outline-none focus:border-blue-500"
                    />
                    <span className="text-sm text-white/40">%</span>
                  </div>
                </div>

                {triggerError && (
                  <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
                    {triggerError}
                  </div>
                )}
              </div>
            )}

          {/* Expandable details */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-white/40 hover:text-white/60"
          >
            {showDetails ? "Hide details ▲" : "Show details ▼"}
          </button>

          {showDetails && (
            <div className="space-y-2 rounded-lg bg-white/5 p-3 text-xs text-white/60">
              <div className="whitespace-pre-line">{rec.explain.details}</div>

              {rec.reasons.length > 0 && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <p className="mb-1 font-medium text-white/70">Factors:</p>
                  {rec.reasons.map((r, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{r.label || r.code}</span>
                      <span className="text-white/50">{r.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-white/30">
                ID: {rec.recommendation_id} | Model: {rec.model_version} | {rec.timestamp}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricBadge({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  const color =
    positive === true
      ? "text-emerald-400"
      : positive === false
        ? "text-red-400"
        : "text-white/60";
  return (
    <span className={`rounded bg-white/5 px-2 py-0.5 ${color}`}>
      <span className="text-white/40">{label}: </span>
      {value}
    </span>
  );
}
