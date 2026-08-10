"use client";

import { useState } from "react";
import { usePairAnalysis } from "@/hooks/use-pair-analysis";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type Props = {
  token1: string;
  token2: string;
  sym1: string;
  sym2: string;
};

const REGIME_LABEL: Record<string, { label: string; variant: "success" | "info" | "secondary" }> = {
  MEAN_REVERSION: { label: "Mean reversion", variant: "success" },
  TREND: { label: "Trend", variant: "info" },
  NEUTRAL: { label: "Neutral", variant: "secondary" },
};

const VERDICT_LABEL: Record<string, { label: string; variant: "success" | "destructive" | "secondary" }> = {
  BEATS_HODL: { label: "Beats holding", variant: "success" },
  UNDERPERFORMS: { label: "Worse than holding", variant: "destructive" },
  INCONCLUSIVE: { label: "Inconclusive", variant: "secondary" },
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

/**
 * Backtest + statistical profile for a pair, computed on real price history.
 * Deliberately shows the honest answer (including "worse than holding") rather
 * than only surfacing positive signals.
 */
export function PairAnalytics({ token1, token2, sym1, sym2 }: Props) {
  const [threshold, setThreshold] = useState(5);
  const [run, setRun] = useState(false);
  const { data, isFetching, isError, refetch } = usePairAnalysis(token1, token2, {
    thresholdPct: threshold,
    enabled: run,
  });

  const stats = data?.stats;
  const bt = data?.backtest;
  const regime = stats ? REGIME_LABEL[stats.regime] ?? REGIME_LABEL.NEUTRAL : null;
  const verdict = bt ? VERDICT_LABEL[bt.verdict] ?? VERDICT_LABEL.INCONCLUSIVE : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Backtest &amp; statistics</CardTitle>
        <Button
          size="sm"
          disabled={isFetching}
          onClick={() => {
            if (!run) setRun(true);
            else refetch();
          }}
        >
          {isFetching ? "Analyzing…" : run ? "Re-run" : "Run analysis"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!run && !isFetching && (
          <p className="text-sm text-muted-foreground">
            Test this pair on real price history: is the spread statistically
            mean-reverting, and would rebalancing have beaten simply holding —
            after fees?
          </p>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rebalance band</span>
          {[3, 5, 10].map((t) => (
            <Button
              key={t}
              size="sm"
              variant={threshold === t ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => {
                setThreshold(t);
                if (run) setRun(true);
              }}
            >
              {t}%
            </Button>
          ))}
        </div>

        {isFetching && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            Fetching candles and running the backtest…
          </p>
        )}

        {isError && (
          <p className="text-sm text-destructive">Analysis request failed.</p>
        )}

        {!isFetching && data && !data.ok && (
          <p className="text-sm text-muted-foreground">
            {data.reason ?? "Not enough price history for this pair."}
          </p>
        )}

        {!isFetching && data?.ok && bt && (
          <>
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Rebalancing vs holding
                </span>
                {verdict && (
                  <Badge variant={verdict.variant} className="text-[10px]">
                    {verdict.label}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Rebalancing"
                  value={`${bt.strategy_return_pct > 0 ? "+" : ""}${bt.strategy_return_pct}%`}
                />
                <Stat
                  label="Hold (no trades)"
                  value={`${bt.hodl_return_pct > 0 ? "+" : ""}${bt.hodl_return_pct}%`}
                />
                <Stat
                  label="Difference"
                  value={`${bt.excess_return_pct > 0 ? "+" : ""}${bt.excess_return_pct}%`}
                  hint="after fees"
                />
                <Stat label="Trades" value={String(bt.rebalance_count)} hint={`cost ${bt.total_cost_pct}%`} />
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground/70">
                Simulated on {bt.bars} bars ({data.timeframe}). Max drawdown{" "}
                {bt.max_drawdown_pct}%
                {bt.sharpe != null && ` · Sharpe ${bt.sharpe}`}. Past performance
                does not predict future results.
              </p>
            </div>

            {stats && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {sym1}/{sym2} statistics
                    </span>
                    {regime && (
                      <Badge variant={regime.variant} className="text-[10px]">
                        {regime.label}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat
                      label="Spread z-score"
                      value={String(stats.spread_zscore)}
                      hint={Math.abs(stats.spread_zscore) > 2 ? "stretched" : "normal range"}
                    />
                    <Stat
                      label="Half-life"
                      value={stats.half_life_bars != null ? `${stats.half_life_bars} bars` : "—"}
                      hint="time to revert"
                    />
                    <Stat
                      label="Cointegrated"
                      value={stats.is_cointegrated ? "Yes" : "No"}
                      hint={stats.adf_pvalue != null ? `ADF p=${stats.adf_pvalue}` : undefined}
                    />
                    <Stat label="Correlation" value={String(stats.correlation)} />
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    {stats.is_cointegrated
                      ? "The spread is statistically stationary — divergences have historically converged."
                      : "The spread is not statistically stationary, so divergence alone is a weak signal for this pair."}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
