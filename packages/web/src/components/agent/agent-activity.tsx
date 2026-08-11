"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { TOKENS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Trade = {
  agent: string;
  from: string;
  to: string;
  amountIn: string;
  netOut: string;
  fee: string;
  txHash: string;
  timestamp: number | null;
};

const META: Record<string, { symbol: string; decimals: number }> = {
  [TOKENS.WETH.toLowerCase()]: { symbol: "WETH", decimals: 18 },
  [TOKENS.USDC.toLowerCase()]: { symbol: "USDC", decimals: 6 },
  [TOKENS.RNBW.toLowerCase()]: { symbol: "RNBW", decimals: 18 },
  [TOKENS.OWB.toLowerCase()]: { symbol: "OWB", decimals: 18 },
};

const metaOf = (a: string) =>
  META[a.toLowerCase()] ?? { symbol: `${a.slice(0, 6)}…`, decimals: 18 };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function ago(ts: number | null) {
  if (!ts) return "";
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function amt(raw: string, decimals: number) {
  return Number(formatUnits(BigInt(raw), decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

/**
 * Agent trades, read from the chain rather than our execution log — agents run
 * outside this service, so nothing here would know about them otherwise.
 */
export function AgentActivity({ vault }: { vault: `0x${string}` }) {
  const { data, isLoading } = useQuery({
    queryKey: ["agent-activity", vault],
    queryFn: async () => {
      const res = await fetch(`/api/agent/activity?vault=${vault}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{
        trades?: Trade[];
        count?: number;
        note?: string;
        error?: string;
      }>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const trades = data?.trades ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Agent activity</CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            {isLoading ? "…" : `${trades.length} recent`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Reading the chain…
          </p>
        ) : data?.error ? (
          <p className="py-4 text-center text-sm text-destructive">
            Could not read activity.
          </p>
        ) : trades.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No trades yet in the scanned window.
          </p>
        ) : (
          <div className="space-y-2">
            {trades.map((t) => {
              const f = metaOf(t.from);
              const to = metaOf(t.to);
              return (
                <a
                  key={t.txHash}
                  href={`https://basescan.org/tx/${t.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-foreground">
                      {amt(t.amountIn, f.decimals)} {f.symbol} &rarr;{" "}
                      {amt(t.netOut, to.decimals)} {to.symbol}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {ago(t.timestamp)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    <span>agent {short(t.agent)}</span>
                    <span>
                      fee {amt(t.fee, to.decimals)} {to.symbol}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Read from <code>AgentTraded</code> events on Base, not from our
          records — agents run outside this service. Only recent blocks are
          scanned, so older trades exist on-chain without appearing here.
        </p>
      </CardContent>
    </Card>
  );
}
