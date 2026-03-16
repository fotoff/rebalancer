"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { usePortfolioTokens } from "@/hooks/use-portfolio-tokens";
import {
  usePairSuggestions,
  type SuggestedPair,
} from "@/hooks/use-pair-suggestions";

type PairSuggestionsProps = {
  onCreatePair: (token1: string, token2: string) => void;
};

const ACTION_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  HOLD: { label: "Hold", color: "text-white/50", bg: "bg-white/10" },
  REBALANCE_NOW: {
    label: "Rebalance now",
    color: "text-emerald-400",
    bg: "bg-emerald-500/20",
  },
  SUGGEST_TRIGGERS: {
    label: "Set triggers",
    color: "text-blue-400",
    bg: "bg-blue-500/20",
  },
};

const REGIME_CONFIG: Record<string, { label: string; color: string }> = {
  MEAN_REVERSION: { label: "Mean Reversion", color: "text-purple-400" },
  TREND: { label: "Trend", color: "text-amber-400" },
  NEUTRAL: { label: "Neutral", color: "text-white/40" },
};

function DivBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null;
  const abs = Math.abs(value);
  const color =
    abs >= 8
      ? "text-emerald-400"
      : abs >= 3
        ? "text-blue-400"
        : "text-white/50";
  return (
    <span className={`text-xs ${color}`}>
      <span className="text-white/30">{label}: </span>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

function PriceChange({ value }: { value: number | null }) {
  if (value == null) return <span className="text-white/30">—</span>;
  const color =
    value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-white/50";
  return (
    <span className={color}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function PairSuggestions({ onCreatePair }: PairSuggestionsProps) {
  const { address } = useAccount();
  const { items } = usePortfolioTokens();
  const { suggestions, loading, error, fetchSuggestions } =
    usePairSuggestions();
  const [createdPairs, setCreatedPairs] = useState<Set<string>>(new Set());

  const handleScan = useCallback(() => {
    if (!items.length || !address) return;
    fetchSuggestions({
      holdings: items.map((i) => ({
        token: i.tokenAddress,
        symbol: i.symbol,
        balance: i.balance,
        usdValue: i.usdValue,
      })),
      userAddress: address,
    });
  }, [items, address, fetchSuggestions]);

  const handleAddPair = useCallback(
    (pair: SuggestedPair) => {
      const key = `${pair.tokenA}-${pair.tokenB}`;
      setCreatedPairs((prev) => new Set(prev).add(key));
      onCreatePair(pair.tokenA, pair.tokenB);
    },
    [onCreatePair]
  );

  if (!address || items.length < 2) return null;

  const actionable = suggestions.filter((s) => s.action !== "HOLD");
  const holdPairs = suggestions.filter((s) => s.action === "HOLD");

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Rebalancing Opportunities
        </h2>
        <button
          onClick={handleScan}
          disabled={loading || items.length < 2}
          className="rounded-lg bg-[#0052FF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0046e0] disabled:opacity-50"
        >
          {loading
            ? "Scanning..."
            : suggestions.length > 0
              ? "Rescan"
              : "Find opportunities"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-white/50">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          Analyzing {items.length} tokens, checking all pair combinations...
        </div>
      )}

      {!loading && suggestions.length === 0 && !error && (
        <p className="text-sm text-white/40">
          Scan your wallet to discover which token pairs have rebalancing potential
          based on price divergence analysis.
        </p>
      )}

      {!loading && suggestions.length > 0 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="rounded bg-white/5 px-2 py-1 text-white/50">
              {suggestions.length} pair{suggestions.length !== 1 ? "s" : ""} analyzed
            </span>
            {actionable.length > 0 && (
              <span className="rounded bg-blue-500/10 px-2 py-1 text-blue-400">
                {actionable.length} with opportunity
              </span>
            )}
          </div>

          {/* Actionable pairs first */}
          {actionable.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {actionable.map((pair) => (
                <PairCard
                  key={`${pair.tokenA}-${pair.tokenB}`}
                  pair={pair}
                  created={createdPairs.has(`${pair.tokenA}-${pair.tokenB}`)}
                  onAdd={handleAddPair}
                />
              ))}
            </div>
          )}

          {/* Hold pairs (collapsed) */}
          {holdPairs.length > 0 && (
            <HoldSection pairs={holdPairs} createdPairs={createdPairs} onAdd={handleAddPair} />
          )}
        </div>
      )}
    </div>
  );
}

function PairCard({
  pair,
  created,
  onAdd,
}: {
  pair: SuggestedPair;
  created: boolean;
  onAdd: (p: SuggestedPair) => void;
}) {
  const actionCfg = ACTION_CONFIG[pair.action] ?? ACTION_CONFIG.HOLD;
  const regimeCfg = REGIME_CONFIG[pair.regime] ?? REGIME_CONFIG.NEUTRAL;
  const isHold = pair.action === "HOLD";

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${
        isHold
          ? "border-white/10 bg-black/30"
          : pair.action === "REBALANCE_NOW"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-blue-500/20 bg-blue-500/5"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-white">
          {pair.symbolA} / {pair.symbolB}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-medium ${actionCfg.bg} ${actionCfg.color}`}
        >
          {actionCfg.label}
        </span>
      </div>

      {/* Regime + Edge */}
      <div className="flex items-center gap-3 text-xs">
        <span className={regimeCfg.color}>{regimeCfg.label}</span>
        {pair.expected_edge_bps > 0 && (
          <span className="text-white/50">
            Edge: <span className="text-emerald-400">+{pair.expected_edge_bps.toFixed(0)} bps</span>
          </span>
        )}
      </div>

      {/* Divergence bars */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <DivBadge value={pair.divergence_1h} label="1h" />
        <DivBadge value={pair.divergence_6h} label="6h" />
        <DivBadge value={pair.divergence_24h} label="24h" />
      </div>

      {/* Price changes */}
      <div className="flex gap-3 text-xs">
        <span>
          <span className="text-white/30">{pair.symbolA} 24h: </span>
          <PriceChange value={pair.price_change_a_24h} />
        </span>
        <span>
          <span className="text-white/30">{pair.symbolB} 24h: </span>
          <PriceChange value={pair.price_change_b_24h} />
        </span>
      </div>

      {/* Rationale */}
      <p className="text-[11px] text-white/40">{pair.rationale}</p>

      {/* Add pair button */}
      <button
        onClick={() => onAdd(pair)}
        disabled={created}
        className="mt-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
      >
        {created ? "✓ Pair added" : "Add pair"}
      </button>
    </div>
  );
}

function HoldSection({
  pairs,
  createdPairs,
  onAdd,
}: {
  pairs: SuggestedPair[];
  createdPairs: Set<string>;
  onAdd: (p: SuggestedPair) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-white/40 hover:text-white/60"
      >
        {expanded ? "Hide" : "Show"} {pairs.length} low-opportunity pair
        {pairs.length !== 1 ? "s" : ""} {expanded ? "▲" : "▼"}
      </button>
      {expanded && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pairs.map((pair) => (
            <PairCard
              key={`${pair.tokenA}-${pair.tokenB}`}
              pair={pair}
              created={createdPairs.has(`${pair.tokenA}-${pair.tokenB}`)}
              onAdd={onAdd}
            />
          ))}
        </div>
      )}
    </div>
  );
}
