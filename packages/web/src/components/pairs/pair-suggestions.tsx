"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { usePortfolioTokens } from "@/hooks/use-portfolio-tokens";
import {
  usePairSuggestions,
  type SuggestedPair,
} from "@/hooks/use-pair-suggestions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type PairSuggestionsProps = {
  onCreatePair: (token1: string, token2: string) => void;
};

const ACTION_CONFIG: Record<
  string,
  { label: string; variant: "success" | "info" | "secondary" }
> = {
  HOLD: { label: "Hold", variant: "secondary" },
  REBALANCE_NOW: { label: "Rebalance now", variant: "success" },
  SUGGEST_TRIGGERS: { label: "Set triggers", variant: "info" },
};

const REGIME_CONFIG: Record<string, { label: string; color: string }> = {
  MEAN_REVERSION: { label: "Mean Reversion", color: "text-purple-600" },
  TREND: { label: "Trend", color: "text-amber-600" },
  NEUTRAL: { label: "Neutral", color: "text-muted-foreground" },
};

function DivBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null;
  const abs = Math.abs(value);
  const color =
    abs >= 8
      ? "text-emerald-600"
      : abs >= 3
        ? "text-blue-600"
        : "text-muted-foreground";
  return (
    <span className={`text-xs ${color}`}>
      <span className="text-muted-foreground/70">{label}: </span>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

function PriceChange({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground/50">—</span>;
  const color =
    value > 0 ? "text-emerald-600" : value < 0 ? "text-red-600" : "text-muted-foreground";
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
  const { suggestions, loading, error, fetchSuggestions, loadCached } =
    usePairSuggestions();
  const [createdPairs, setCreatedPairs] = useState<Set<string>>(new Set());
  // Age (ms) of a restored cached scan; null once a fresh one runs.
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  const handleScan = useCallback(() => {
    if (!items.length || !address) return;
    setCacheAge(null);
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

  // On first load (once the portfolio is ready): show the last saved scan with
  // its date, or auto-run a fresh scan if nothing is cached.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    if (!address || items.length < 2) return;
    didInit.current = true;
    const age = loadCached(address);
    if (age == null) handleScan();
    else setCacheAge(age);
  }, [address, items.length, loadCached, handleScan]);

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
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Rebalancing Opportunities
          </h2>
          <Button
            onClick={handleScan}
            disabled={loading || items.length < 2}
            size="sm"
          >
            {loading
              ? "Scanning..."
              : suggestions.length > 0
                ? "Rescan"
                : "Find opportunities"}
          </Button>
        </div>

        {cacheAge != null && !loading && suggestions.length > 0 && (
          <p className="mb-3 text-xs text-amber-600">
            Saved scan from{" "}
            {cacheAge < 60_000
              ? "just now"
              : cacheAge >= 3_600_000
                ? `${Math.floor(cacheAge / 3_600_000)}h ago`
                : `${Math.floor(cacheAge / 60_000)}m ago`}{" "}
            — click Rescan to refresh.
          </p>
        )}

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Analyzing {items.length} tokens, checking all pair combinations...
          </div>
        )}

        {!loading && suggestions.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            Scan your wallet to discover which token pairs have rebalancing potential
            based on price divergence analysis.
          </p>
        )}

        {!loading && suggestions.length > 0 && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex flex-wrap gap-3 text-xs">
              <Badge variant="secondary">
                {suggestions.length} pair{suggestions.length !== 1 ? "s" : ""} analyzed
              </Badge>
              {actionable.length > 0 && (
                <Badge variant="info">
                  {actionable.length} with opportunity
                </Badge>
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
      </CardContent>
    </Card>
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
          ? "border-border bg-card"
          : pair.action === "REBALANCE_NOW"
            ? "border-emerald-200 bg-emerald-50"
            : "border-blue-200 bg-blue-50"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">
          {pair.symbolA} / {pair.symbolB}
        </span>
        <Badge variant={actionCfg.variant} className="text-[10px]">
          {actionCfg.label}
        </Badge>
      </div>

      {/* Regime + Edge */}
      <div className="flex items-center gap-3 text-xs">
        <span className={regimeCfg.color}>{regimeCfg.label}</span>
        {pair.expected_edge_bps > 0 && (
          <span className="text-muted-foreground">
            Edge: <span className="text-emerald-600">+{pair.expected_edge_bps.toFixed(0)} bps</span>
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
          <span className="text-muted-foreground/70">{pair.symbolA} 24h: </span>
          <PriceChange value={pair.price_change_a_24h} />
        </span>
        <span>
          <span className="text-muted-foreground/70">{pair.symbolB} 24h: </span>
          <PriceChange value={pair.price_change_b_24h} />
        </span>
      </div>

      {/* Rationale */}
      <p className="text-[11px] text-muted-foreground">{pair.rationale}</p>

      {/* Add pair button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAdd(pair)}
        disabled={created}
        className="mt-auto"
      >
        {created ? "✓ Pair added" : "Add pair"}
      </Button>
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
        className="text-xs text-muted-foreground hover:text-foreground transition"
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
