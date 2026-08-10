"use client";

import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { useTokenInfo } from "@/hooks/use-token-info";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { useTokenMeta } from "@/hooks/use-token-meta";
import { useVaultBalances } from "@/hooks/use-vault-balances";
import { useUserVault } from "@/hooks/use-user-vault";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PairPermissions } from "./pair-permissions";

export type SavedPair = {
  id: string;
  userAddress: string;
  token1: string;
  token2: string;
  createdAt: string;
};

type SavedPairsProps = {
  onSelectPair: (token1: string, token2: string) => void;
};

function PriceChange({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground/50">—</span>;
  const color =
    value > 0
      ? "text-emerald-600"
      : value < 0
        ? "text-red-600"
        : "text-muted-foreground";
  return (
    <span className={color}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function SavedPairs({ onSelectPair }: SavedPairsProps) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { vaultAddress } = useUserVault();

  // Pairs with on-chain auto-rebalance permissions can't be deleted until disabled.
  const [lockedPairs, setLockedPairs] = useState<Record<string, boolean>>({});
  const setPairLocked = useCallback((id: string, locked: boolean) => {
    setLockedPairs((prev) => (prev[id] === locked ? prev : { ...prev, [id]: locked }));
  }, []);

  const { data: pairs = [] } = useQuery({
    queryKey: ["pairs", address],
    queryFn: async () => {
      const res = await fetch(
        `/api/pairs?address=${encodeURIComponent(address ?? "")}`
      );
      if (!res.ok) return [];
      return res.json() as Promise<SavedPair[]>;
    },
    enabled: !!address,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  type TriggerInfo = { id: string; pairId: string; status?: string };
  const { data: triggers = [] } = useQuery({
    queryKey: ["allTriggers", address],
    queryFn: async () => {
      const res = await fetch(
        `/api/triggers?address=${encodeURIComponent(address ?? "")}`
      );
      if (!res.ok) return [];
      return res.json() as Promise<TriggerInfo[]>;
    },
    enabled: !!address,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const { activeTriggersByPair, firedTriggersByPair } = useMemo(() => {
    const active: Record<string, number> = {};
    const fired: Record<string, number> = {};
    for (const t of triggers) {
      if (!t.pairId) continue;
      if (t.status === "triggered") {
        fired[t.pairId] = (fired[t.pairId] ?? 0) + 1;
      } else {
        active[t.pairId] = (active[t.pairId] ?? 0) + 1;
      }
    }
    return { activeTriggersByPair: active, firedTriggersByPair: fired };
  }, [triggers]);

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/pairs?id=${id}&userAddress=${address}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairs", address] });
    },
  });

  const uniqueAddrs = useMemo(() => {
    const set = new Set(
      pairs.flatMap((p) => [p.token1.toLowerCase(), p.token2.toLowerCase()])
    );
    return [...set];
  }, [pairs]);
  const { data: prices } = useTokenPrices(uniqueAddrs);
  const { data: tokenMeta } = useTokenMeta(uniqueAddrs);

  const { getSymbol, getDecimals } = useTokenInfo(uniqueAddrs);

  const { data: balanceResults } = useReadContracts({
    contracts: uniqueAddrs.map((addr) => ({
      address: addr as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address as `0x${string}`],
    })),
    query: { enabled: !!address && uniqueAddrs.length > 0 },
  });

  const balances: Record<string, number> = {};
  if (balanceResults) {
    uniqueAddrs.forEach((addr, i) => {
      const raw = balanceResults[i]?.result as bigint | undefined;
      if (raw != null) {
        balances[addr] = Number(formatUnits(raw, getDecimals(addr)));
      }
    });
  }

  const { vaultBalances: vaultBalancesRaw } = useVaultBalances(uniqueAddrs);

  const vaultBalances: Record<string, number> = {};
  for (const addr of uniqueAddrs) {
    const raw = vaultBalancesRaw[addr];
    if (raw != null && raw > 0n) {
      vaultBalances[addr] = Number(formatUnits(raw, getDecimals(addr)));
    }
  }

  if (pairs.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          My pairs
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pairs.map((p) => {
            const addr1 = p.token1.toLowerCase();
            const addr2 = p.token2.toLowerCase();
            const sym1 = getSymbol(p.token1);
            const sym2 = getSymbol(p.token2);
            const price1 = prices?.[addr1] ?? 0;
            const price2 = prices?.[addr2] ?? 0;
            const walBal1 = balances[addr1] ?? 0;
            const walBal2 = balances[addr2] ?? 0;
            const vBal1 = vaultBalances[addr1] ?? 0;
            const vBal2 = vaultBalances[addr2] ?? 0;
            const totalBal1 = walBal1 + vBal1;
            const totalBal2 = walBal2 + vBal2;
            const usd1 = totalBal1 * price1;
            const usd2 = totalBal2 * price2;
            const totalUsd = usd1 + usd2;
            const pct1 = totalUsd > 0 ? (usd1 / totalUsd) * 100 : 50;
            const pct2 = totalUsd > 0 ? (usd2 / totalUsd) * 100 : 50;
            const ratio = price2 > 0 ? price1 / price2 : 0;

            const pairId = [addr1, addr2].sort().join("-");
            const activeCount = activeTriggersByPair[pairId] ?? 0;
            const firedCount = firedTriggersByPair[pairId] ?? 0;

            const meta1 = tokenMeta?.[addr1];
            const meta2 = tokenMeta?.[addr2];
            const change24h_1 = meta1?.priceChange24h ?? 0;
            const change24h_2 = meta2?.priceChange24h ?? 0;

            const diff24h = Math.abs(change24h_1 - change24h_2);
            const isImbalanced = diff24h >= 50;

            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectPair(p.token1, p.token2)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    onSelectPair(p.token1, p.token2);
                }}
                className={`group flex cursor-pointer flex-col gap-2 rounded-lg border px-4 py-3 transition hover:shadow-md ${
                  isImbalanced
                    ? "border-amber-200 bg-amber-50 hover:border-amber-300"
                    : "border-border bg-card hover:border-primary/30"
                }`}
              >
                {/* Header: pair name + delete */}
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {sym1} ⟷ {sym2}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (lockedPairs[p.id]) return;
                      removeMutation.mutate(p.id);
                    }}
                    disabled={removeMutation.isPending || lockedPairs[p.id]}
                    className="rounded p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 group-hover:disabled:opacity-40"
                    title={
                      lockedPairs[p.id]
                        ? "Disable auto-rebalance permissions before removing this pair"
                        : "Remove pair"
                    }
                  >
                    ✕
                  </button>
                </div>

                {/* Trigger badges */}
                {(activeCount > 0 || firedCount > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeCount > 0 && (
                      <Badge variant="success" className="text-[10px]">
                        {activeCount} active{" "}
                        {activeCount === 1 ? "trigger" : "triggers"}
                      </Badge>
                    )}
                    {firedCount > 0 && (
                      <Badge variant="info" className="text-[10px]">
                        {firedCount} fired
                      </Badge>
                    )}
                  </div>
                )}

                {/* Auto-rebalance permissions (on-chain, per pair) */}
                <PairPermissions
                  token1={p.token1}
                  token2={p.token2}
                  sym1={sym1}
                  sym2={sym2}
                  vault={vaultAddress}
                  onLockedChange={(locked) => setPairLocked(p.id, locked)}
                />

                {/* Prices */}
                <div className="text-xs text-muted-foreground">
                  {price1 > 0 && (
                    <span>
                      {sym1}: ${price1 >= 1 ? price1.toFixed(2) : price1.toFixed(6)}
                    </span>
                  )}
                  {price1 > 0 && price2 > 0 && <span> · </span>}
                  {price2 > 0 && (
                    <span>
                      {sym2}: ${price2 >= 1 ? price2.toFixed(2) : price2.toFixed(6)}
                    </span>
                  )}
                </div>

                {/* Ratio */}
                {ratio > 0 && (
                  <div className="text-xs text-muted-foreground/70">
                    1 {sym1} ={" "}
                    {ratio.toLocaleString(undefined, {
                      maximumFractionDigits: ratio >= 1 ? 0 : 4,
                    })}{" "}
                    {sym2}
                  </div>
                )}

                {/* Balances & percentages */}
                <div className="mt-1 space-y-1">
                  <div className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground/80">
                        {sym1}:{" "}
                        {walBal1.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                      <span className="text-muted-foreground">
                        {pct1.toFixed(1)}%
                        {usd1 > 0 && (
                          <span className="ml-1 text-muted-foreground/70">
                            ${usd1.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </span>
                    </div>
                    {vBal1 > 0 && (
                      <div className="pl-2 text-[10px] text-cyan-600">
                        + {vBal1.toLocaleString(undefined, { maximumFractionDigits: 4 })} in vault
                      </div>
                    )}
                  </div>
                  <div className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground/80">
                        {sym2}:{" "}
                        {walBal2.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                      <span className="text-muted-foreground">
                        {pct2.toFixed(1)}%
                        {usd2 > 0 && (
                          <span className="ml-1 text-muted-foreground/70">
                            ${usd2.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </span>
                    </div>
                    {vBal2 > 0 && (
                      <div className="pl-2 text-[10px] text-cyan-600">
                        + {vBal2.toLocaleString(undefined, { maximumFractionDigits: 4 })} in vault
                      </div>
                    )}
                  </div>

                  {/* Balance bar */}
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="rounded-l-full bg-blue-500"
                      style={{ width: `${pct1}%` }}
                    />
                    <div
                      className="rounded-r-full bg-purple-500"
                      style={{ width: `${pct2}%` }}
                    />
                  </div>
                </div>

                {/* Price changes 1h / 24h */}
                <div className="mt-1 flex gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground/70">1h: </span>
                    <PriceChange value={meta1?.priceChange1h} />
                    <span className="text-muted-foreground/40"> / </span>
                    <PriceChange value={meta2?.priceChange1h} />
                  </div>
                  <div>
                    <span className="text-muted-foreground/70">24h: </span>
                    <PriceChange value={meta1?.priceChange24h} />
                    <span className="text-muted-foreground/40"> / </span>
                    <PriceChange value={meta2?.priceChange24h} />
                  </div>
                </div>

                {/* Imbalance warning */}
                {isImbalanced && (
                  <div className="mt-1 text-xs text-amber-600">
                    ⚠ 24h spread: {diff24h.toFixed(1)}% — rebalancing recommended
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
