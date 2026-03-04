"use client";

import { useState, useCallback, useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { REBALANCER_VAULT_ADDRESS } from "@/lib/constants";
import { VAULT_ABI } from "@/lib/vault-abi";

export type Trigger = {
  id: string;
  pairId: string;
  userAddress: string;
  direction: "1to2" | "2to1";
  metric: "price" | "ratio";
  priceToken?: string;
  type: "gte" | "lte" | "eq";
  value: number;
  fromToken: string;
  toToken: string;
  autoEnabled: boolean;
  amountMode?: "percent" | "tokens";
  amount?: number;
  status?: string;
  lastTriggered?: string;
  txHash?: string;
  autoTaskId?: string;
};

const OPERATORS = [
  { value: "gte" as const, label: "≥", desc: "Rise to (greater or equal)" },
  { value: "lte" as const, label: "≤", desc: "Fall to (less or equal)" },
  { value: "eq" as const, label: "=", desc: "Reach (exact)" },
] as const;

const PERCENT_PRESETS = [25, 50, 75, 100] as const;

type TriggerFormProps = {
  token1: string;
  token2: string;
  fromToken: string;
  toToken: string;
  fromSym: string;
  toSym: string;
  sym1: string;
  sym2: string;
  dec1: number;
  dec2: number;
  price1: number;
  price2: number;
  ratio: number;
  direction: "1to2" | "2to1";
  onDirectionChange?: (d: "1to2" | "2to1") => void;
  fromBalance: number;
};

export function TriggerForm({
  token1,
  token2,
  fromToken,
  toToken,
  fromSym,
  toSym,
  sym1,
  sym2,
  dec1,
  dec2,
  price1,
  price2,
  ratio,
  direction,
  onDirectionChange,
  fromBalance,
}: TriggerFormProps) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [metric, setMetric] = useState<"price" | "ratio">("price");
  const [priceToken, setPriceToken] = useState<string>(token1);
  const [triggerType, setTriggerType] = useState<"gte" | "lte" | "eq">("gte");
  const [triggerValue, setTriggerValue] = useState(
    metric === "ratio" ? ratio.toFixed(2) : ""
  );

  // Amount state
  const [amountMode, setAmountMode] = useState<"percent" | "tokens">("percent");
  const [amountValue, setAmountValue] = useState("100");

  const pairId = [token1, token2].map((a) => a.toLowerCase()).sort().join("-");

  const { data: triggers = [] } = useQuery({
    queryKey: ["triggers", address, pairId],
    queryFn: async () => {
      const res = await fetch(
        `/api/triggers?address=${encodeURIComponent(address ?? "")}&pairId=${encodeURIComponent(pairId)}`
      );
      if (!res.ok) return [];
      return res.json() as Promise<Trigger[]>;
    },
    enabled: !!address,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async (trigger: Omit<Trigger, "id">) => {
      const res = await fetch("/api/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...trigger, pairId, userAddress: address }),
      });
      if (!res.ok) throw new Error("Failed to add trigger");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["triggers", address, pairId] });
      setTriggerValue(metric === "ratio" ? ratio.toFixed(2) : "");
      setAmountValue("100");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/triggers?id=${id}&userAddress=${address}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["triggers", address, pairId] });
    },
  });

  // Auto-mode toggle (direct PATCH)
  const [autoToggling, setAutoToggling] = useState<string | null>(null);
  const toggleAuto = useCallback(
    async (triggerId: string, enable: boolean) => {
      setAutoToggling(triggerId);
      try {
        await fetch("/api/triggers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: triggerId,
            userAddress: address,
            autoEnabled: enable,
            status: enable ? "active" : "disabled",
          }),
        });
        queryClient.invalidateQueries({
          queryKey: ["triggers", address, pairId],
        });
      } catch (err) {
        console.error("Toggle auto error:", err);
      } finally {
        setAutoToggling(null);
      }
    },
    [address, pairId, queryClient]
  );

  const handleAdd = () => {
    const val = parseFloat(triggerValue);
    if (isNaN(val) || val <= 0) return;
    if (metric === "price" && val <= 0) return;

    const amt = parseFloat(amountValue);
    if (isNaN(amt) || amt <= 0) return;
    if (amountMode === "percent" && amt > 100) return;

    addMutation.mutate({
      pairId,
      userAddress: address ?? "",
      direction,
      metric,
      priceToken: metric === "price" ? priceToken : undefined,
      type: triggerType,
      value: val,
      fromToken,
      toToken,
      autoEnabled: true,
      amountMode,
      amount: amt,
    });
  };

  const formatCondition = (t: Trigger) => {
    const op = OPERATORS.find((o) => o.value === t.type)?.label ?? t.type;
    if (t.metric === "price" && t.priceToken) {
      const sym =
        t.priceToken.toLowerCase() === token1.toLowerCase() ? sym1 : sym2;
      return `Price ${sym} ${op} $${t.value.toLocaleString()}`;
    }
    return `Ratio 1 ${sym1} ${op} ${t.value.toLocaleString()} ${sym2}`;
  };

  const formatAction = (t: Trigger) => {
    const sellSym =
      t.fromToken.toLowerCase() === token1.toLowerCase() ? sym1 : sym2;
    const buySym =
      t.toToken.toLowerCase() === token1.toLowerCase() ? sym1 : sym2;
    return `Sell ${sellSym}, buy ${buySym}`;
  };

  const formatAmount = (t: Trigger) => {
    if (!t.amount) return "";
    if (t.amountMode === "percent") return `${parseFloat(t.amount.toFixed(2))}%`;
    const sellSym =
      t.fromToken.toLowerCase() === token1.toLowerCase() ? sym1 : sym2;
    return `${t.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${sellSym}`;
  };

  const currentVal = parseFloat(triggerValue);
  const currentAmt = parseFloat(amountValue);
  const canAdd =
    !isNaN(currentVal) &&
    currentVal > 0 &&
    !isNaN(currentAmt) &&
    currentAmt > 0 &&
    (amountMode !== "percent" || currentAmt <= 100) &&
    (metric === "ratio" || (metric === "price" && currentVal > 0));

  // Pre-computed filtered trigger lists (avoid double .filter() in JSX)
  const activeTriggers = useMemo(
    () => triggers.filter((t) => t.status !== "triggered"),
    [triggers]
  );
  const historyTriggers = useMemo(
    () =>
      triggers
        .filter((t) => t.status === "triggered")
        .sort((a, b) => {
          const da = a.lastTriggered ? new Date(a.lastTriggered).getTime() : 0;
          const db = b.lastTriggered ? new Date(b.lastTriggered).getTime() : 0;
          return db - da;
        }),
    [triggers]
  );

  // Computed token amount for display
  const resolvedTokens =
    amountMode === "percent" && !isNaN(currentAmt)
      ? (fromBalance * currentAmt) / 100
      : currentAmt;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-4 text-lg font-semibold text-white">
        Triggers (automatic rebalancing)
      </h3>

      {/* Direction toggle */}
      {onDirectionChange && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onDirectionChange(direction === "1to2" ? "2to1" : "1to2")
            }
            className="flex items-center gap-2 rounded-lg bg-[#0052FF] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#0046e0]"
          >
            <span>
              {fromSym} → {toSym}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-70"
            >
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
          <span className="text-xs text-white/50">
            Sell {fromSym}, buy {toSym}
          </span>
        </div>
      )}

      <div className="space-y-4">
        {/* ---- Metric selector ---- */}
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={metric === "price"}
              onChange={() => {
                setMetric("price");
                setTriggerValue("");
              }}
              className="rounded-full"
            />
            <span className="text-sm text-white/80">By token price</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={metric === "ratio"}
              onChange={() => {
                setMetric("ratio");
                setTriggerValue(ratio.toFixed(2));
              }}
              className="rounded-full"
            />
            <span className="text-sm text-white/80">By ratio</span>
          </label>
        </div>

        {metric === "price" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-white/60">Price</span>
            <select
              value={priceToken}
              onChange={(e) => setPriceToken(e.target.value)}
              className="rounded border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
            >
              <option value={token1}>{sym1}</option>
              <option value={token2}>{sym2}</option>
            </select>
          </div>
        )}

        {/* ---- Condition row ---- */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-white/80">
            {metric === "ratio"
              ? `When 1 ${sym1} =`
              : "When price (USD) ="}
          </span>
          <select
            value={triggerType}
            onChange={(e) =>
              setTriggerType(e.target.value as "gte" | "lte" | "eq")
            }
            className="rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value} title={o.desc}>
                {o.label} {o.desc}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={triggerValue}
            onChange={(e) => setTriggerValue(e.target.value)}
            step={metric === "price" ? "0.01" : "0.0001"}
            placeholder={metric === "ratio" ? ratio.toFixed(2) : "0"}
            className="w-32 rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
          />
          {metric === "ratio" && (
            <span className="text-white/80">{sym2}</span>
          )}
          {metric === "price" && (
            <span className="text-white/80">USD</span>
          )}
          {metric === "price" && (() => {
            const currentPrice = priceToken.toLowerCase() === token1.toLowerCase() ? price1 : price2;
            const selectedSym = priceToken.toLowerCase() === token1.toLowerCase() ? sym1 : sym2;
            return currentPrice > 0 ? (
              <span className="text-xs text-white/40">
                Now: <span className="text-white/60 font-medium">${currentPrice < 0.01 ? currentPrice.toPrecision(4) : currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
              </span>
            ) : null;
          })()}
        </div>

        {/* ---- Amount selector ---- */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
          <p className="text-sm font-medium text-white/70">
            How much to rebalance
          </p>

          {/* Mode toggle */}
          <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => {
                setAmountMode("percent");
                setAmountValue("100");
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                amountMode === "percent"
                  ? "bg-[#0052FF] text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              % of balance
            </button>
            <button
              type="button"
              onClick={() => {
                setAmountMode("tokens");
                setAmountValue("");
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                amountMode === "tokens"
                  ? "bg-[#0052FF] text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              Token amount
            </button>
          </div>

          {/* Percent presets */}
          {amountMode === "percent" && (
            <div className="flex gap-2">
              {PERCENT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmountValue(String(p))}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    amountValue === String(p)
                      ? "bg-white/20 text-white"
                      : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
                  }`}
                >
                  {p}%
                </button>
              ))}
            </div>
          )}

          {/* Amount input */}
          <div className="flex items-center gap-2">
            <div className="relative w-full">
              <input
                type="number"
                value={amountValue}
                onChange={(e) => setAmountValue(e.target.value)}
                placeholder={
                  amountMode === "percent"
                    ? "100"
                    : fromBalance > 0
                      ? fromBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })
                      : "0"
                }
                min={0}
                max={amountMode === "percent" ? 100 : undefined}
                step={amountMode === "percent" ? "1" : "0.000001"}
                className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 pr-16 text-white placeholder:text-white/30"
              />
              {amountMode === "tokens" && fromBalance > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setAmountValue(
                      fromBalance.toLocaleString("en", {
                        maximumFractionDigits: 18,
                        useGrouping: false,
                      })
                    )
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-white/60 hover:bg-white/20 hover:text-white"
                >
                  MAX
                </button>
              )}
            </div>
            <span className="shrink-0 text-sm text-white/60">
              {amountMode === "percent" ? "%" : fromSym}
            </span>
          </div>

          {/* Available balance hint */}
          {amountMode === "tokens" && fromBalance > 0 && (
            <p className="text-xs text-white/40">
              Available:{" "}
              {fromBalance.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              {fromSym}
            </p>
          )}

          {/* Resolved amount hint */}
          {amountMode === "percent" && !isNaN(currentAmt) && currentAmt > 0 && fromBalance > 0 && (
            <p className="text-xs text-white/40">
              ≈{" "}
              {resolvedTokens.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              {fromSym}
            </p>
          )}
          {amountMode === "tokens" && !isNaN(currentAmt) && currentAmt > 0 && fromBalance > 0 && (
            <p className="text-xs text-white/40">
              ≈{" "}
              {((currentAmt / fromBalance) * 100).toFixed(1)}% of balance
            </p>
          )}
        </div>

        <p className="text-sm text-white/50">
          Action: Sell {fromSym}, buy {toSym}
        </p>

        <button
          type="button"
          onClick={handleAdd}
          disabled={!address || !canAdd || addMutation.isPending}
          className="rounded-lg bg-[#0052FF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0046e0] disabled:opacity-50"
        >
          {addMutation.isPending ? "Adding…" : "Add trigger"}
        </button>

        {/* ---- Active triggers ---- */}
        {activeTriggers.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
            <p className="text-sm font-medium text-white/80">Active triggers</p>
            {activeTriggers.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="text-white/90">{formatCondition(t)}</span>
                      <span className="ml-2 text-white/50">→ {formatAction(t)}</span>
                      {t.amount && (
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/50">
                          {formatAmount(t)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(t.id)}
                      disabled={removeMutation.isPending}
                      className="ml-2 shrink-0 text-red-400/80 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                  {/* Auto-mode toggle */}
                  <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleAuto(t.id, !t.autoEnabled)}
                        disabled={autoToggling === t.id}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                          t.autoEnabled ? "bg-emerald-500" : "bg-white/20"
                        } ${autoToggling === t.id ? "opacity-50" : ""}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                            t.autoEnabled ? "translate-x-4" : "translate-x-0.5"
                          } mt-0.5`}
                        />
                      </button>
                    <span className="text-xs text-white/50">
                      {autoToggling === t.id
? "Toggling…"
                          : t.autoEnabled
                          ? "Trigger on"
                          : "Trigger off"}
                    </span>
                    </div>
                    {t.autoEnabled && (
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      Active
                    </span>
                    )}
                    {t.status === "disabled" && !t.autoEnabled && (
                    <span className="rounded bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-400">
                      Auto-stop (balance 0)
                    </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* ---- Trigger history ---- */}
        {historyTriggers.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
            <p className="text-sm font-medium text-white/80">Trigger history</p>
            {historyTriggers.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="text-white/70">{formatCondition(t)}</span>
                      <span className="ml-2 text-white/40">→ {formatAction(t)}</span>
                      {t.amount && (
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/40">
                          {formatAmount(t)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(t.id)}
                      disabled={removeMutation.isPending}
                      className="ml-2 shrink-0 text-red-400/50 hover:text-red-400"
                      title="Remove from history"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      Executed
                    </span>
                    {t.lastTriggered && (
                      <span className="text-xs text-white/40">
                        {new Date(t.lastTriggered).toLocaleString("ru")}
                      </span>
                    )}
                    {t.txHash && (
                      <a
                        href={`https://basescan.org/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400/80 hover:text-blue-400 hover:underline"
                      >
                        TX: {t.txHash.slice(0, 10)}…{t.txHash.slice(-6)}
                      </a>
                    )}
                    {/* Re-activate button */}
                    <button
                      type="button"
                      onClick={() => toggleAuto(t.id, true)}
                      disabled={autoToggling === t.id}
                      className="ml-auto rounded bg-white/10 px-2 py-0.5 text-xs text-white/60 hover:bg-white/20 hover:text-white"
                    >
                      {autoToggling === t.id ? "…" : "Turn on again"}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* ---- Rebalance stats ---- */}
        <RebalanceStats
          token1={token1}
          token2={token2}
          sym1={sym1}
          sym2={sym2}
          dec1={dec1}
          dec2={dec2}
          triggers={triggers}
        />

        {/* ---- Deposit warning at the bottom of the card ---- */}
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <strong>For automatic rebalancing</strong> you need to deposit tokens
          into the contract. Otherwise triggers cannot execute swaps.
        </p>
      </div>
    </div>
  );
}

/* ---- VaultEvent type (from /api/vault/history) ---- */
type VaultEvent = {
  id: string;
  userAddress: string;
  pairId?: string;
  type: "deposit" | "withdraw" | "rebalance";
  token: string;
  amount: string;
  fromToken?: string;
  toToken?: string;
  amountIn?: string;
  amountOut?: string;
  txHash?: string;
  timestamp: string;
};

/* ---- Rebalance Stats Component ---- */
function RebalanceStats({
  token1,
  token2,
  sym1,
  sym2,
  dec1,
  dec2,
  triggers,
}: {
  token1: string;
  token2: string;
  sym1: string;
  sym2: string;
  dec1: number;
  dec2: number;
  triggers: Trigger[];
}) {
  const { address } = useAccount();
  const vaultAddr = REBALANCER_VAULT_ADDRESS as `0x${string}`;
  const hasVault = vaultAddr !== "0x0000000000000000000000000000000000000000";

  const addr1 = token1.toLowerCase();
  const addr2 = token2.toLowerCase();

  // Pair ID for filtering history
  const pairId = [addr1, addr2].sort().join("-");

  // Read ACTUAL vault balances from the smart contract (always correct, never negative)
  const { data: vaultData } = useReadContracts({
    contracts: [
      {
        address: vaultAddr,
        abi: VAULT_ABI,
        functionName: "balances",
        args: address ? [address, token1 as `0x${string}`] : undefined,
      },
      {
        address: vaultAddr,
        abi: VAULT_ABI,
        functionName: "balances",
        args: address ? [address, token2 as `0x${string}`] : undefined,
      },
    ],
    query: { enabled: !!address && hasVault },
  });

  const cur1 = Number(formatUnits((vaultData?.[0]?.result as bigint) ?? 0n, dec1));
  const cur2 = Number(formatUnits((vaultData?.[1]?.result as bigint) ?? 0n, dec2));

  // Fetch ALL user history (no pair filter) — for total deposits per token
  const { data: allHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ["vault-history-all", address],
    queryFn: async () => {
      const res = await fetch(
        `/api/vault/history?address=${encodeURIComponent(address ?? "")}`
      );
      if (!res.ok) return [];
      return res.json() as Promise<VaultEvent[]>;
    },
    enabled: !!address && hasVault,
    staleTime: 15_000,
  });

  // "Deposited" = total deposits for each token across ALL pairs
  let depRaw1 = 0n, depRaw2 = 0n, wdRaw1 = 0n, wdRaw2 = 0n;
  // Rebalance count — only for THIS pair
  let historyRebalanceCount = 0;

  for (const e of allHistory) {
    if (e.type === "deposit") {
      const t = e.token.toLowerCase();
      if (t === addr1) depRaw1 += BigInt(e.amount || "0");
      if (t === addr2) depRaw2 += BigInt(e.amount || "0");
    }
    if (e.type === "withdraw") {
      const t = e.token.toLowerCase();
      if (t === addr1) wdRaw1 += BigInt(e.amount || "0");
      if (t === addr2) wdRaw2 += BigInt(e.amount || "0");
    }
    if (e.type === "rebalance") {
      const from = e.fromToken?.toLowerCase();
      const to = e.toToken?.toLowerCase();
      // Only count rebalances between THIS pair's tokens
      if ((from === addr1 && to === addr2) || (from === addr2 && to === addr1)) {
        historyRebalanceCount++;
      }
    }
  }

  const dep1 = Number(formatUnits(depRaw1, dec1));
  const dep2 = Number(formatUnits(depRaw2, dec2));
  const wd1 = Number(formatUnits(wdRaw1, dec1));
  const wd2 = Number(formatUnits(wdRaw2, dec2));
  const net1 = dep1 - wd1;
  const net2 = dep2 - wd2;

  // Rebalance count: max of triggers history and local history
  const triggerCount = triggers.filter((t) => t.status === "triggered").length;
  const rebalanceCount = Math.max(triggerCount, historyRebalanceCount);

  // Calculate % change: actual vault balance vs total net deposited
  const change1 = net1 > 0 ? ((cur1 - net1) / net1) * 100 : 0;
  const change2 = net2 > 0 ? ((cur2 - net2) / net2) * 100 : 0;

  // Show block if vault has balance or deposits or rebalances
  const hasData = cur1 > 0 || cur2 > 0 || dep1 > 0 || dep2 > 0 || rebalanceCount > 0;
  if (!hasVault || !address) return null;
  if (!hasData && !historyLoading) return null;

  const changeColor = (v: number) =>
    v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-white/50";

  const fmt = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
      <p className="text-sm font-medium text-white/80">
        Rebalance stats
      </p>

      {historyLoading ? (
        <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-center text-xs text-white/40">
          Loading data…
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="mb-3 text-xs text-white/40">
            Total rebalances:{" "}
            <span className="font-medium text-white/70">
              {rebalanceCount}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {/* Header */}
            <div className="text-white/40" />
            <div className="text-center text-white/40">Deposited</div>
            <div className="text-center text-white/40">Now</div>
            <div className="text-center text-white/40">Change</div>

            {/* Token 1 */}
            <div className="font-medium text-white/70">{sym1}</div>
            <div className="text-center text-white/60">
              {net1 > 0 ? fmt(net1) : dep1 > 0 ? fmt(dep1) : "—"}
            </div>
            <div className="text-center text-white/90">{fmt(cur1)}</div>
            <div
              className={`text-center font-medium ${changeColor(change1)}`}
            >
              {net1 > 0 ? (
                <>
                  {change1 > 0 ? "+" : ""}
                  {change1.toFixed(1)}%
                </>
              ) : (
                "—"
              )}
            </div>

            {/* Token 2 */}
            <div className="font-medium text-white/70">{sym2}</div>
            <div className="text-center text-white/60">
              {net2 > 0 ? fmt(net2) : dep2 > 0 ? fmt(dep2) : "—"}
            </div>
            <div className="text-center text-white/90">{fmt(cur2)}</div>
            <div
              className={`text-center font-medium ${changeColor(change2)}`}
            >
              {net2 > 0 ? (
                <>
                  {change2 > 0 ? "+" : ""}
                  {change2.toFixed(1)}%
                </>
              ) : (
                "—"
              )}
            </div>
          </div>

          {/* Withdrawals note */}
          {(wd1 > 0 || wd2 > 0) && (
            <div className="mt-2 border-t border-white/5 pt-2 text-[10px] text-white/30">
              Withdrawn: {wd1 > 0 ? `${fmt(wd1)} ${sym1}` : ""}
              {wd1 > 0 && wd2 > 0 ? ", " : ""}
              {wd2 > 0 ? `${fmt(wd2)} ${sym2}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
