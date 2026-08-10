"use client";

import { useState, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useVaultBalances } from "@/hooks/use-vault-balances";
import { useUserVault } from "@/hooks/use-user-vault";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

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
  { value: "gte" as const, label: "\u2265", desc: "Rise to (greater or equal)" },
  { value: "lte" as const, label: "\u2264", desc: "Fall to (less or equal)" },
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
    <Card>
      <CardHeader>
        <CardTitle>Triggers (automatic rebalancing)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Direction toggle */}
        {onDirectionChange && (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() =>
                onDirectionChange(direction === "1to2" ? "2to1" : "1to2")
              }
              size="sm"
              className="flex items-center gap-2"
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
            </Button>
            <span className="text-xs text-muted-foreground">
              Sell {fromSym}, buy {toSym}
            </span>
          </div>
        )}

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
            <span className="text-sm text-foreground/80">By token price</span>
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
            <span className="text-sm text-foreground/80">By ratio</span>
          </label>
        </div>

        {metric === "price" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Price</span>
            <select
              value={priceToken}
              onChange={(e) => setPriceToken(e.target.value)}
              className="rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value={token1}>{sym1}</option>
              <option value={token2}>{sym2}</option>
            </select>
          </div>
        )}

        {/* ---- Condition row ---- */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-foreground/80">
            {metric === "ratio"
              ? `When 1 ${sym1} =`
              : "When price (USD) ="}
          </span>
          <select
            value={triggerType}
            onChange={(e) =>
              setTriggerType(e.target.value as "gte" | "lte" | "eq")
            }
            className="rounded border border-input bg-background px-3 py-2 text-foreground"
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value} title={o.desc}>
                {o.label} {o.desc}
              </option>
            ))}
          </select>
          <Input
            type="number"
            value={triggerValue}
            onChange={(e) => setTriggerValue(e.target.value)}
            step={metric === "price" ? "0.01" : "0.0001"}
            placeholder={metric === "ratio" ? ratio.toFixed(2) : "0"}
            className="w-32"
          />
          {metric === "ratio" && (
            <span className="text-foreground/80">{sym2}</span>
          )}
          {metric === "price" && (
            <span className="text-foreground/80">USD</span>
          )}
          {metric === "price" && (() => {
            const currentPrice = priceToken.toLowerCase() === token1.toLowerCase() ? price1 : price2;
            return currentPrice > 0 ? (
              <span className="text-xs text-muted-foreground/70">
                Now: <span className="text-muted-foreground font-medium">${currentPrice < 0.01 ? currentPrice.toPrecision(4) : currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
              </span>
            ) : null;
          })()}
        </div>

        {/* ---- Amount selector ---- */}
        <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
          <p className="text-sm font-medium text-foreground/70">
            How much to rebalance
          </p>

          {/* Mode toggle */}
          <Tabs value={amountMode} onValueChange={(v) => { if (v === "percent") { setAmountMode("percent"); setAmountValue("100"); } else { setAmountMode("tokens"); setAmountValue(""); } }}>
            <TabsList className="w-full">
              <TabsTrigger value="percent" className="flex-1">% of balance</TabsTrigger>
              <TabsTrigger value="tokens" className="flex-1">Token amount</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Percent presets */}
          {amountMode === "percent" && (
            <div className="flex gap-2">
              {PERCENT_PRESETS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={amountValue === String(p) ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setAmountValue(String(p))}
                  className="text-sm"
                >
                  {p}%
                </Button>
              ))}
            </div>
          )}

          {/* Amount input */}
          <div className="flex items-center gap-2">
            <div className="relative w-full">
              <Input
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
                className="pr-16"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  MAX
                </button>
              )}
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">
              {amountMode === "percent" ? "%" : fromSym}
            </span>
          </div>

          {/* Available balance hint */}
          {amountMode === "tokens" && fromBalance > 0 && (
            <p className="text-xs text-muted-foreground/70">
              Available:{" "}
              {fromBalance.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              {fromSym}
            </p>
          )}

          {/* Resolved amount hint */}
          {amountMode === "percent" && !isNaN(currentAmt) && currentAmt > 0 && fromBalance > 0 && (
            <p className="text-xs text-muted-foreground/70">
              &asymp;{" "}
              {resolvedTokens.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              {fromSym}
            </p>
          )}
          {amountMode === "tokens" && !isNaN(currentAmt) && currentAmt > 0 && fromBalance > 0 && (
            <p className="text-xs text-muted-foreground/70">
              &asymp;{" "}
              {((currentAmt / fromBalance) * 100).toFixed(1)}% of balance
            </p>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Action: Sell {fromSym}, buy {toSym}
        </p>

        <Button
          type="button"
          onClick={handleAdd}
          disabled={!address || !canAdd || addMutation.isPending}
        >
          {addMutation.isPending ? "Adding..." : "Add trigger"}
        </Button>

        {/* ---- Active triggers ---- */}
        {activeTriggers.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <p className="text-sm font-medium text-foreground/80">Active triggers</p>
            {activeTriggers.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground/90">{formatCondition(t)}</span>
                      <span className="ml-2 text-muted-foreground">&rarr; {formatAction(t)}</span>
                      {t.amount && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {formatAmount(t)}
                        </Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(t.id)}
                      disabled={removeMutation.isPending}
                      className="ml-2 shrink-0 text-red-600/80 hover:text-red-600"
                    >
                      &#10005;
                    </button>
                  </div>
                  {/* Auto-mode toggle */}
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={t.autoEnabled}
                        onCheckedChange={(checked) => toggleAuto(t.id, checked)}
                        disabled={autoToggling === t.id}
                      />
                    <span className="text-xs text-muted-foreground">
                      {autoToggling === t.id
                        ? "Toggling..."
                        : t.autoEnabled
                          ? "Trigger on"
                          : "Trigger off"}
                    </span>
                    </div>
                    {t.autoEnabled && (
                      <Badge variant="success">Active</Badge>
                    )}
                    {t.status === "disabled" && !t.autoEnabled && (
                      <Badge variant="warning">Auto-stop (balance 0)</Badge>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* ---- Trigger history ---- */}
        {historyTriggers.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <p className="text-sm font-medium text-foreground/80">Trigger history</p>
            {historyTriggers.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground/70">{formatCondition(t)}</span>
                      <span className="ml-2 text-muted-foreground/70">&rarr; {formatAction(t)}</span>
                      {t.amount && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {formatAmount(t)}
                        </Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(t.id)}
                      disabled={removeMutation.isPending}
                      className="ml-2 shrink-0 text-red-600/50 hover:text-red-600"
                      title="Remove from history"
                    >
                      &#10005;
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                    <Badge variant="success">Executed</Badge>
                    {t.lastTriggered && (
                      <span className="text-xs text-muted-foreground/70">
                        {new Date(t.lastTriggered).toLocaleString("ru")}
                      </span>
                    )}
                    {t.txHash && (
                      <a
                        href={`https://basescan.org/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600/80 hover:text-blue-600 hover:underline"
                      >
                        TX: {t.txHash.slice(0, 10)}...{t.txHash.slice(-6)}
                      </a>
                    )}
                    {/* Re-activate button */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleAuto(t.id, true)}
                      disabled={autoToggling === t.id}
                      className="ml-auto text-xs"
                    >
                      {autoToggling === t.id ? "..." : "Turn on again"}
                    </Button>
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
        <Alert className="border-amber-200 bg-amber-50">
          <AlertDescription className="text-sm text-amber-600">
            <strong>For automatic rebalancing</strong> you need to deposit tokens
            into the contract. Otherwise triggers cannot execute swaps.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
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
  const { hasVault } = useUserVault();

  const addr1 = token1.toLowerCase();
  const addr2 = token2.toLowerCase();

  // Pair ID for filtering history
  const pairId = [addr1, addr2].sort().join("-");

  // Actual balances inside the user's personal (non-custodial) vault.
  const { vaultBalances } = useVaultBalances([token1, token2]);
  const cur1 = Number(formatUnits(vaultBalances[addr1] ?? 0n, dec1));
  const cur2 = Number(formatUnits(vaultBalances[addr2] ?? 0n, dec2));

  // Fetch ALL user history (no pair filter) -- for total deposits per token
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
  // Rebalance count -- only for THIS pair
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
    v > 0 ? "text-emerald-600" : v < 0 ? "text-red-600" : "text-muted-foreground";

  const fmt = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <div className="space-y-2">
      <Separator />
      <p className="text-sm font-medium text-foreground/80">
        Rebalance stats
      </p>

      {historyLoading ? (
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <Skeleton className="mx-auto h-4 w-32" />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-3 text-xs text-muted-foreground/70">
            Total rebalances:{" "}
            <span className="font-medium text-foreground/70">
              {rebalanceCount}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {/* Header */}
            <div className="text-muted-foreground/70" />
            <div className="text-center text-muted-foreground/70">Deposited</div>
            <div className="text-center text-muted-foreground/70">Now</div>
            <div className="text-center text-muted-foreground/70">Change</div>

            {/* Token 1 */}
            <div className="font-medium text-foreground/70">{sym1}</div>
            <div className="text-center text-muted-foreground">
              {net1 > 0 ? fmt(net1) : dep1 > 0 ? fmt(dep1) : "\u2014"}
            </div>
            <div className="text-center text-foreground/90">{fmt(cur1)}</div>
            <div
              className={`text-center font-medium ${changeColor(change1)}`}
            >
              {net1 > 0 ? (
                <>
                  {change1 > 0 ? "+" : ""}
                  {change1.toFixed(1)}%
                </>
              ) : (
                "\u2014"
              )}
            </div>

            {/* Token 2 */}
            <div className="font-medium text-foreground/70">{sym2}</div>
            <div className="text-center text-muted-foreground">
              {net2 > 0 ? fmt(net2) : dep2 > 0 ? fmt(dep2) : "\u2014"}
            </div>
            <div className="text-center text-foreground/90">{fmt(cur2)}</div>
            <div
              className={`text-center font-medium ${changeColor(change2)}`}
            >
              {net2 > 0 ? (
                <>
                  {change2 > 0 ? "+" : ""}
                  {change2.toFixed(1)}%
                </>
              ) : (
                "\u2014"
              )}
            </div>
          </div>

          {/* Withdrawals note */}
          {(wd1 > 0 || wd2 > 0) && (
            <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground/70">
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
