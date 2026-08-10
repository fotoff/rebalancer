"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import {
  useAiRecommendation,
  type AiRecommendation,
} from "@/hooks/use-ai-recommendation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

const ACTION_LABELS: Record<string, { label: string; variant: "secondary" | "success" | "info" }> = {
  HOLD: { label: "Hold", variant: "secondary" },
  REBALANCE_NOW: { label: "Rebalance now", variant: "success" },
  SUGGEST_TRIGGERS: { label: "Create triggers", variant: "info" },
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
    loadCached,
  } = useAiRecommendation();

  const [creatingTriggers, setCreatingTriggers] = useState(false);
  const [triggersCreated, setTriggersCreated] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [rebalancePct, setRebalancePct] = useState<string>("");
  // Age (ms) of a restored cached analysis; null once we have a fresh one.
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  const handleGetRecommendation = () => {
    setTriggersCreated(false);
    setTriggerError(null);
    setRebalancePct("");
    setCacheAge(null);
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

  // On card open: show the last saved analysis instantly (flagged as possibly
  // outdated), or auto-run a fresh one if there's nothing cached.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    const age = loadCached(pairId);
    if (age == null) {
      handleGetRecommendation();
    } else {
      setCacheAge(age);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairId]);

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
    <Card>
      <CardHeader>
        <CardTitle>AI Advisor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Refresh / Get recommendation button */}
        <Button
          onClick={handleGetRecommendation}
          disabled={loading}
        >
          {loading ? "Analyzing..." : rec ? "Refresh" : "Get recommendation"}
        </Button>

        {cacheAge != null && rec && !loading && (
          <p className="text-xs text-amber-600">
            Showing your last saved analysis
            {cacheAge > 60_000
              ? ` (${cacheAge >= 3_600_000
                  ? `${Math.floor(cacheAge / 3_600_000)}h`
                  : `${Math.floor(cacheAge / 60_000)}m`} ago)`
              : ""}
            {" "}— it may be outdated. Click Refresh to update.
          </p>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!rec && !loading && !error && (
          <p className="text-sm text-muted-foreground/70">
            Click &quot;Get recommendation&quot; for AI analysis of {sym1}/{sym2}
          </p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Analyzing {sym1}/{sym2}...
          </div>
        )}

        {rec && !loading && (
          <div className="space-y-3">
            {/* Action badge + regime */}
            <div className="flex items-center gap-3">
              <Badge variant={actionInfo?.variant ?? "secondary"}>
                {actionInfo?.label}
              </Badge>
              <span className="text-xs text-muted-foreground/70">
                {REGIME_LABELS[rec.expected.regime] || rec.expected.regime}
              </span>
            </div>

            {/* Short explanation */}
            <p className="text-sm text-foreground/80">{rec.explain.short}</p>

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
                  <Alert
                    key={i}
                    variant={v.severity === "BLOCK" ? "destructive" : "default"}
                    className={v.severity !== "BLOCK" ? "border-amber-200 bg-amber-50" : ""}
                  >
                    <AlertDescription className={`text-xs ${v.severity === "BLOCK" ? "" : "text-amber-600"}`}>
                      {v.severity === "BLOCK" ? "Blocked" : "Warning"}: {v.message}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {/* Trigger suggestions */}
            {(rec.action === "SUGGEST_TRIGGERS" || rec.action === "REBALANCE_NOW") &&
              rec.triggers_suggestion.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <p className="mb-2 text-sm font-medium text-blue-600">
                    Suggested triggers:
                  </p>
                  {rec.triggers_suggestion.map((t, i) => (
                    <div key={i} className="mb-1 text-sm text-foreground/70">
                      &bull; {t.label || `${t.type}: ${t.trigger_type} ${t.value.toFixed(4)}, ${t.rebalance_pct}%`}
                    </div>
                  ))}

                  {/* Create triggers row: input + button */}
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      onClick={handleCreateTriggers}
                      disabled={creatingTriggers || triggersCreated}
                      size="sm"
                    >
                      {triggersCreated
                        ? "Triggers created"
                        : creatingTriggers
                          ? "Creating..."
                          : "Create triggers"}
                    </Button>

                    {/* Editable rebalance % */}
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        placeholder={String(defaultPct)}
                        value={rebalancePct}
                        onChange={(e) => setRebalancePct(e.target.value)}
                        className="w-16 text-center text-sm"
                      />
                      <span className="text-sm text-muted-foreground/70">%</span>
                    </div>
                  </div>

                  {triggerError && (
                    <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
                      {triggerError}
                    </div>
                  )}
                </div>
              )}

            {/* Expandable details */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-muted-foreground/70 hover:text-foreground"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>

            {showDetails && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <div className="whitespace-pre-line">{rec.explain.details}</div>

                {rec.reasons.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2">
                    <p className="mb-1 font-medium text-foreground/70">Factors:</p>
                    {rec.reasons.map((r, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{r.label || r.code}</span>
                        <span className="text-muted-foreground">{r.detail}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground/70">
                  ID: {rec.recommendation_id} | Model: {rec.model_version} | {rec.timestamp}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
      ? "text-emerald-600"
      : positive === false
        ? "text-red-600"
        : "text-muted-foreground";
  return (
    <span className={`rounded bg-muted px-2 py-0.5 ${color}`}>
      <span className="text-muted-foreground/70">{label}: </span>
      {value}
    </span>
  );
}
