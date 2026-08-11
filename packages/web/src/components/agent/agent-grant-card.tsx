"use client";

import { useState } from "react";
import { useReadContracts, useWriteContract, usePublicClient } from "wagmi";
import { keccak256, encodePacked, formatUnits } from "viem";
import { AGENT_VAULT_ABI } from "@/lib/agent-abi";
import type { GrantRef } from "@/lib/agent-grants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const pairKey = (a: `0x${string}`, b: `0x${string}`) =>
  keccak256(encodePacked(["address", "address"], [a, b]));

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Solidity tuple order from AgentVault.AgentPermission.
type Permission = readonly [
  boolean, // enabled
  number, // maxSlippageBps
  number, // cooldown
  bigint, // lastExec
  bigint, // expiresAt
  bigint, // maxNotional
  boolean, // trustAgentMinOut
];

function expiryLabel(expiresAt: bigint) {
  if (expiresAt === 0n) return "no expiry";
  const secs = Number(expiresAt) - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "expired";
  const days = Math.floor(secs / 86400);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(secs / 3600);
  return hours >= 1 ? `${hours}h left` : "<1h left";
}

/**
 * One granted (agent, from -> to) permission. Every value shown is read from the
 * vault, never from local state, so a grant revoked elsewhere renders correctly.
 */
export function AgentGrantCard({
  vault,
  grant,
  symbolOf,
  decimalsOf,
  onRevoked,
  onForget,
}: {
  vault: `0x${string}`;
  grant: GrantRef;
  symbolOf: (addr: string) => string;
  decimalsOf: (addr: string) => number;
  onRevoked: () => void;
  onForget: () => void;
}) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, refetch, isLoading } = useReadContracts({
    contracts: [
      {
        address: vault,
        abi: AGENT_VAULT_ABI,
        functionName: "permissions",
        args: [grant.agent, pairKey(grant.from, grant.to)],
      },
      {
        address: vault,
        abi: AGENT_VAULT_ABI,
        functionName: "remainingBudget",
        args: [grant.agent, grant.from],
      },
    ],
  });

  const perm = data?.[0]?.result as Permission | undefined;
  const remaining = data?.[1]?.result as bigint | undefined;

  const enabled = Boolean(perm?.[0]);
  const expiresAt = perm?.[4] ?? 0n;
  const maxNotional = perm?.[5] ?? 0n;
  const trusted = Boolean(perm?.[6]);
  const expired = expiresAt !== 0n && Number(expiresAt) * 1000 < Date.now();

  const dec = decimalsOf(grant.from);
  const fmt = (v: bigint) =>
    v === 0n
      ? "unlimited"
      : `${Number(formatUnits(v, dec)).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })} ${symbolOf(grant.from)}`;

  async function revoke() {
    setErr(null);
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: vault,
        abi: AGENT_VAULT_ABI,
        functionName: "revokeAgentPair",
        args: [grant.agent, grant.from, grant.to],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetch();
      onRevoked();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message.slice(0, 90) : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-xs text-foreground">
            {short(grant.agent)}
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">
            {symbolOf(grant.from)} &rarr; {symbolOf(grant.to)}
          </div>
        </div>
        {isLoading ? (
          <Badge variant="secondary" className="text-[10px]">
            reading…
          </Badge>
        ) : enabled && !expired ? (
          <Badge variant="success" className="text-[10px]">
            active
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">
            {expired ? "expired" : "revoked"}
          </Badge>
        )}
      </div>

      {!isLoading && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Max slippage</dt>
            <dd className="text-foreground">
              {((perm?.[1] ?? 0) / 100).toFixed(2)}%
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Cooldown</dt>
            <dd className="text-foreground">{perm?.[2] ?? 0}s</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Per trade</dt>
            <dd className="text-foreground">{fmt(maxNotional)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Expiry</dt>
            <dd className="text-foreground">{expiryLabel(expiresAt)}</dd>
          </div>
          <div className="col-span-2 flex justify-between">
            <dt className="text-muted-foreground">Budget left (24h)</dt>
            <dd className="text-foreground">
              {remaining === undefined
                ? "—"
                : remaining > 2n ** 200n
                  ? "unlimited"
                  : fmt(remaining)}
            </dd>
          </div>
          {trusted && (
            <div className="col-span-2 text-[10px] text-amber-700">
              Trusts the agent&apos;s quote — this pair has no oracle.
            </div>
          )}
        </dl>
      )}

      <div className="mt-3 flex gap-2">
        {enabled && !expired ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={revoke}
            className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
          >
            {busy ? "Revoking…" : "Revoke"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onForget}
            className="h-7 px-2 text-[11px] text-muted-foreground"
          >
            Remove from list
          </Button>
        )}
      </div>

      {err && <p className="mt-2 text-[10px] text-destructive">{err}</p>}
    </div>
  );
}
