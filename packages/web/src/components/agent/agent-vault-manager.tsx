"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { isAddress, parseUnits, formatUnits, erc20Abi } from "viem";
import { useAgentVault } from "@/hooks/use-agent-vault";
import { AGENT_FACTORY_ABI, AGENT_VAULT_ABI } from "@/lib/agent-abi";
import { FACTORY_ABI } from "@/lib/noncustodial-abi";
import {
  AGENT_FACTORY_ADDRESS,
  FACTORY_ADDRESS,
  TOKENS,
} from "@/lib/constants";
import {
  loadGrantRefs,
  rememberGrantRef,
  forgetGrantRef,
  type GrantRef,
} from "@/lib/agent-grants";
import { AgentGrantCard } from "./agent-grant-card";
import { AgentVaultDeposit } from "./agent-vault-deposit";
import { AgentActivity } from "./agent-activity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// WETH/USDC are oracle-backed; the rest have no feed, so granting them requires
// the owner to explicitly trust the agent's quote (same opt-in the operator-driven
// vault uses for these pairs today).
const PAIR_TOKENS = [
  { address: TOKENS.WETH, symbol: "WETH", decimals: 18 },
  { address: TOKENS.USDC, symbol: "USDC", decimals: 6 },
  { address: TOKENS.RNBW, symbol: "RNBW", decimals: 18 },
  { address: TOKENS.OWB, symbol: "OWB", decimals: 18 },
] as const;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const EXPIRY_CHOICES = [
  { label: "24 hours", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
] as const;

export function AgentVaultManager() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { factoryConfigured, vaultAddress, hasVault, isLoading, refetch } =
    useAgentVault();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [grants, setGrants] = useState<GrantRef[]>([]);

  // Grant form
  const [agent, setAgent] = useState("");
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [maxNotional, setMaxNotional] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [trustQuote, setTrustQuote] = useState(false);

  const from = PAIR_TOKENS[fromIdx];
  const to = PAIR_TOKENS[toIdx];

  const symbolOf = useCallback(
    (addr: string) =>
      PAIR_TOKENS.find((t) => t.address.toLowerCase() === addr.toLowerCase())
        ?.symbol ?? short(addr),
    []
  );
  const decimalsOf = useCallback(
    (addr: string) =>
      PAIR_TOKENS.find((t) => t.address.toLowerCase() === addr.toLowerCase())
        ?.decimals ?? 18,
    []
  );

  useEffect(() => {
    if (vaultAddress) setGrants(loadGrantRefs(vaultAddress));
  }, [vaultAddress]);

  // Vault token balances — what an agent would actually be trading.
  const { data: balances, refetch: refetchBalances } = useReadContracts({
    contracts: PAIR_TOKENS.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [vaultAddress ?? "0x0"] as const,
    })),
    query: { enabled: Boolean(vaultAddress) },
  });

  // Oracle coverage for the selected direction. Loading and failure are kept
  // distinct from "no oracle": a failed read must not silently look like one,
  // or the trust opt-in below would vanish with no way to grant the pair.
  const {
    data: hasOracle,
    isLoading: oracleLoading,
    isError: oracleError,
  } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "hasOracle",
    args: [from.address, to.address],
    query: { enabled: fromIdx !== toIdx },
  });
  const oracleKnown = !oracleLoading && !oracleError;
  const needsTrust = oracleKnown && hasOracle !== true;

  const totalVaultValue = useMemo(
    () =>
      PAIR_TOKENS.map((t, i) => {
        const bal = balances?.[i]?.result as bigint | undefined;
        return { ...t, balance: bal ?? 0n };
      }),
    [balances]
  );

  async function deployVault() {
    setErr(null);
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: AGENT_FACTORY_ADDRESS,
        abi: AGENT_FACTORY_ABI,
        functionName: "deployAgentVault",
      });
      // Bounded, so a dropped transaction cannot leave the button spinning.
      await publicClient?.waitForTransactionReceipt({ hash, timeout: 120_000 });
      await refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed";
      setErr(
        /timed out|timeout/i.test(msg)
          ? "Not confirmed after two minutes — it may still land. Reload shortly."
          : /rejected|denied/i.test(msg)
            ? "Cancelled in your wallet."
            : msg.slice(0, 120)
      );
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    setErr(null);
    if (!isAddress(agent)) {
      setErr("Enter a valid agent address");
      return;
    }
    if (fromIdx === toIdx) {
      setErr("Pick two different tokens");
      return;
    }
    if (needsTrust && !trustQuote) {
      setErr("No oracle for this pair — tick the trust box to grant it anyway");
      return;
    }
    setBusy(true);
    try {
      const agentAddr = agent as `0x${string}`;
      const expiresAt =
        BigInt(Math.floor(Date.now() / 1000)) + BigInt(expiryDays * 86400);
      const notional = maxNotional
        ? parseUnits(maxNotional, from.decimals)
        : 0n;

      const permHash = await writeContractAsync({
        address: vaultAddress!,
        abi: AGENT_VAULT_ABI,
        functionName: "setAgentPermission",
        args: [
          agentAddr,
          from.address,
          to.address,
          true,
          100, // 1% slippage ceiling; the oracle floor still wins
          300, // 5-min cooldown, same rationale as operator pairs
          expiresAt,
          notional,
          hasOracle ? false : trustQuote, // oracle wins whenever there is one
        ],
      });
      await publicClient?.waitForTransactionReceipt({ hash: permHash });

      if (dailyLimit) {
        const limit = parseUnits(dailyLimit, from.decimals);
        const budgetHash = await writeContractAsync({
          address: vaultAddress!,
          abi: AGENT_VAULT_ABI,
          functionName: "setAgentBudget",
          args: [agentAddr, from.address, limit],
        });
        await publicClient?.waitForTransactionReceipt({ hash: budgetHash });
      }

      const ref: GrantRef = {
        agent: agentAddr,
        from: from.address,
        to: to.address,
      };
      setGrants(rememberGrantRef(vaultAddress!, ref));
      setAgent("");
      setMaxNotional("");
      setDailyLimit("");
      setTrustQuote(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message.slice(0, 120) : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!factoryConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent vault</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The agent factory address is not configured
          (NEXT_PUBLIC_AGENT_FACTORY_ADDRESS).
        </CardContent>
      </Card>
    );
  }

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent vault</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Connect your wallet to deploy an agent vault and manage permissions.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }

  if (!hasVault) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent vault</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Deploy a vault that third-party agents can trade through. You stay
            the owner: only you can withdraw, and every agent you authorise is
            capped by budget, expiry and a per-trade limit you set.
          </p>
          <Button onClick={deployVault} disabled={busy}>
            {busy ? "Deploying…" : "Deploy agent vault"}
          </Button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Vault header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Agent vault</CardTitle>
            <a
              href={`https://basescan.org/address/${vaultAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              {short(vaultAddress!)} &#8599;
            </a>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {totalVaultValue.map((t) => (
              <div
                key={t.address}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <span className="text-sm text-muted-foreground">
                  {t.symbol}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {Number(formatUnits(t.balance, t.decimals)).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 6 }
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Send tokens to this address to fund it. Only you can withdraw —
            agents can trade, never move funds out.
          </p>
        </CardContent>
      </Card>

      <AgentVaultDeposit vault={vaultAddress!} onDeposited={refetchBalances} />

      {/* Grant form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Authorise an agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Agent address
            </label>
            <Input
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              placeholder="0x…"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Sells
              </label>
              <select
                value={fromIdx}
                onChange={(e) => setFromIdx(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {PAIR_TOKENS.map((t, i) => (
                  <option key={t.address} value={i}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Buys
              </label>
              <select
                value={toIdx}
                onChange={(e) => setToIdx(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {PAIR_TOKENS.map((t, i) => (
                  <option key={t.address} value={i}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Max per trade ({from.symbol})
              </label>
              <Input
                value={maxNotional}
                onChange={(e) => setMaxNotional(e.target.value)}
                placeholder="unlimited"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Daily budget ({from.symbol})
              </label>
              <Input
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                placeholder="unlimited"
                inputMode="decimal"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Expires in
            </label>
            <div className="flex gap-2">
              {EXPIRY_CHOICES.map((c) => (
                <Button
                  key={c.days}
                  type="button"
                  size="sm"
                  variant={expiryDays === c.days ? "default" : "outline"}
                  onClick={() => setExpiryDays(c.days)}
                  className="h-7 flex-1 text-[11px]"
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>

          {fromIdx !== toIdx && needsTrust && (
            <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-[11px] leading-snug text-amber-800">
              <input
                type="checkbox"
                checked={trustQuote}
                onChange={(e) => setTrustQuote(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                No oracle for {from.symbol}&nbsp;&rarr;&nbsp;{to.symbol}, so the
                vault cannot bound the price itself. Tick to accept the
                agent&apos;s own quote as the floor. Only do this for an agent
                you run — every other limit still applies.
              </span>
            </label>
          )}

          {fromIdx !== toIdx && oracleError && (
            <p className="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
              Could not read oracle coverage for this pair. Reload before
              granting — do not assume either answer.
            </p>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            The agent gets a 1% slippage ceiling and a 5-minute cooldown.
            {hasOracle
              ? " The oracle floor always wins over the agent's own quote"
              : " Without an oracle the agent's quote is the floor"}
            , and you can revoke at any moment.
          </div>

          <Button
            onClick={grant}
            disabled={
              busy ||
              fromIdx === toIdx ||
              !oracleKnown ||
              (needsTrust && !trustQuote)
            }
            className="w-full"
          >
            {busy ? "Confirming…" : "Authorise agent"}
          </Button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </CardContent>
      </Card>

      <AgentActivity vault={vaultAddress!} />

      {/* Active grants */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Granted permissions
          </h2>
          <Badge variant="secondary" className="text-[10px]">
            {grants.length}
          </Badge>
        </div>
        {grants.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No agents authorised yet.
          </p>
        ) : (
          <div className="space-y-3">
            {grants.map((g) => (
              <AgentGrantCard
                key={`${g.agent}-${g.from}-${g.to}`}
                vault={vaultAddress!}
                grant={g}
                symbolOf={symbolOf}
                decimalsOf={decimalsOf}
                onRevoked={() => refetchBalances()}
                onForget={() =>
                  setGrants(forgetGrantRef(vaultAddress!, g))
                }
              />
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          This list indexes grants made in this browser; every value shown is
          read live from the vault. Grants made directly on-chain won&apos;t
          appear here, but remain fully in effect.
        </p>
      </div>
    </div>
  );
}
