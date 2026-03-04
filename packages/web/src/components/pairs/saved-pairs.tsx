"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { useTokenInfo } from "@/hooks/use-token-info";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { useTokenMeta } from "@/hooks/use-token-meta";
import { useVaultBalances } from "@/hooks/use-vault-balances";

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
  if (value == null) return <span className="text-white/30">—</span>;
  const color =
    value > 0
      ? "text-emerald-400"
      : value < 0
        ? "text-red-400"
        : "text-white/50";
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

  // Fetch triggers to show count per pair
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

  // Count active triggers per pairId (memoized)
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

  // Resolve symbols & decimals (KNOWN_TOKENS cache + on-chain ERC-20 fallback)
  const { getSymbol, getDecimals } = useTokenInfo(uniqueAddrs);

  // Read balances of all pair tokens for the connected wallet
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

  // Shared vault balances (single source of truth via VaultBalancesProvider)
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
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-4 text-lg font-semibold text-white">
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
          const hasVaultBal = vBal1 > 0 || vBal2 > 0;
          const ratio = price2 > 0 ? price1 / price2 : 0;

          const pairId = [addr1, addr2].sort().join("-");
          const activeCount = activeTriggersByPair[pairId] ?? 0;
          const firedCount = firedTriggersByPair[pairId] ?? 0;

          const meta1 = tokenMeta?.[addr1];
          const meta2 = tokenMeta?.[addr2];
          const change24h_1 = meta1?.priceChange24h ?? 0;
          const change24h_2 = meta2?.priceChange24h ?? 0;

          // Highlight if one token grew >50% more than the other in 24h
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
              className={`group flex cursor-pointer flex-col gap-2 rounded-lg border px-4 py-3 transition hover:bg-white/5 ${
                isImbalanced
                  ? "border-amber-500/50 bg-amber-500/5 hover:border-amber-400/70"
                  : "border-white/10 bg-black/30 hover:border-white/30"
              }`}
            >
              {/* Header: pair name + delete */}
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">
                  {sym1} ⟷ {sym2}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMutation.mutate(p.id);
                  }}
                  disabled={removeMutation.isPending}
                  className="rounded p-1.5 text-white/40 opacity-0 transition hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                  title="Remove pair"
                >
                  ✕
                </button>
              </div>

              {/* Trigger badges */}
              {(activeCount > 0 || firedCount > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {activeCount > 0 && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                      {activeCount} active{" "}
                      {activeCount === 1
                        ? "trigger"
                        : "triggers"}
                    </span>
                  )}
                  {firedCount > 0 && (
                    <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                      {firedCount} fired
                    </span>
                  )}
                </div>
              )}

              {/* Prices */}
              <div className="text-xs text-white/50">
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
                <div className="text-xs text-white/40">
                  1 {sym1} ={" "}
                  {ratio.toLocaleString(undefined, {
                    maximumFractionDigits: ratio >= 1 ? 0 : 4,
                  })}{" "}
                  {sym2}
                </div>
              )}

              {/* Balances & percentages */}
              <div className="mt-1 space-y-1">
                {/* Token 1 */}
                <div className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white/70">
                      {sym1}:{" "}
                      {walBal1.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                    <span className="text-white/50">
                      {pct1.toFixed(1)}%
                      {usd1 > 0 && (
                        <span className="ml-1 text-white/40">
                          ${usd1.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </span>
                  </div>
                  {vBal1 > 0 && (
                    <div className="pl-2 text-[10px] text-cyan-400/70">
                      + {vBal1.toLocaleString(undefined, { maximumFractionDigits: 4 })} in vault
                    </div>
                  )}
                </div>
                {/* Token 2 */}
                <div className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white/70">
                      {sym2}:{" "}
                      {walBal2.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                    <span className="text-white/50">
                      {pct2.toFixed(1)}%
                      {usd2 > 0 && (
                        <span className="ml-1 text-white/40">
                          ${usd2.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </span>
                  </div>
                  {vBal2 > 0 && (
                    <div className="pl-2 text-[10px] text-cyan-400/70">
                      + {vBal2.toLocaleString(undefined, { maximumFractionDigits: 4 })} in vault
                    </div>
                  )}
                </div>

                {/* Balance bar */}
                <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="rounded-l-full bg-blue-500/60"
                    style={{ width: `${pct1}%` }}
                  />
                  <div
                    className="rounded-r-full bg-purple-500/60"
                    style={{ width: `${pct2}%` }}
                  />
                </div>
              </div>

              {/* Price changes 1h / 24h */}
              <div className="mt-1 flex gap-4 text-xs">
                <div>
                  <span className="text-white/40">1h: </span>
                  <PriceChange value={meta1?.priceChange1h} />
                  <span className="text-white/20"> / </span>
                  <PriceChange value={meta2?.priceChange1h} />
                </div>
                <div>
                  <span className="text-white/40">24h: </span>
                  <PriceChange value={meta1?.priceChange24h} />
                  <span className="text-white/20"> / </span>
                  <PriceChange value={meta2?.priceChange24h} />
                </div>
              </div>

              {/* Imbalance warning */}
              {isImbalanced && (
                <div className="mt-1 text-xs text-amber-400">
                  ⚠ 24h spread: {diff24h.toFixed(1)}% — rebalancing recommended
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
