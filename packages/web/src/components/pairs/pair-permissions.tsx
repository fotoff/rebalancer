"use client";

import { useEffect, useState } from "react";
import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { keccak256, encodePacked } from "viem";
import { FACTORY_ADDRESS } from "@/lib/constants";
import { FACTORY_ABI, USER_VAULT_ABI } from "@/lib/noncustodial-abi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const key = (a: `0x${string}`, b: `0x${string}`) =>
  keccak256(encodePacked(["address", "address"], [a, b]));

/**
 * Per-pair auto-rebalance permission control, embedded in a saved-pair card.
 * Reads both directions' on-chain policy, lets the user allow/disable both at
 * once, and reports `locked` upward so the parent can block pair deletion.
 */
export function PairPermissions({
  token1,
  token2,
  sym1,
  sym2,
  vault,
  onLockedChange,
}: {
  token1: string;
  token2: string;
  sym1: string;
  sym2: string;
  vault: `0x${string}` | null;
  onLockedChange: (locked: boolean) => void;
}) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const t1 = token1 as `0x${string}`;
  const t2 = token2 as `0x${string}`;

  const [busy, setBusy] = useState(false);
  const [trust, setTrust] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: hasOracle } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "hasOracle",
    args: [t1, t2],
  });

  const { data: policies, refetch } = useReadContracts({
    contracts: [
      { address: vault ?? undefined, abi: USER_VAULT_ABI, functionName: "pairPolicy", args: [key(t1, t2)] },
      { address: vault ?? undefined, abi: USER_VAULT_ABI, functionName: "pairPolicy", args: [key(t2, t1)] },
    ],
    query: { enabled: Boolean(vault) },
  });

  const p12 = policies?.[0]?.result as readonly [boolean, number, number, bigint, boolean] | undefined;
  const p21 = policies?.[1]?.result as readonly [boolean, number, number, bigint, boolean] | undefined;
  const allowed = Boolean(p12?.[0]) || Boolean(p21?.[0]);
  const trusted = Boolean(p12?.[4]) || Boolean(p21?.[4]);

  useEffect(() => {
    onLockedChange(allowed);
  }, [allowed, onLockedChange]);

  async function setBoth(allow: boolean) {
    setErr(null);
    if (allow && !hasOracle && !trust) {
      setErr("Tick the trust box first");
      return;
    }
    setBusy(true);
    try {
      const trustFlag = allow ? (hasOracle ? false : trust) : false;
      // 5-min on-chain cooldown per pair: harmless for one-shot triggers, but caps
      // how fast a compromised operator key could churn-bleed an allowed pair.
      const COOLDOWN = 300;
      for (const [a, b] of [
        [t1, t2],
        [t2, t1],
      ] as const) {
        const h = await writeContractAsync({
          address: vault!,
          abi: USER_VAULT_ABI,
          functionName: "setPairPolicy",
          args: [a, b, allow, 100, COOLDOWN, trustFlag],
        });
        await publicClient?.waitForTransactionReceipt({ hash: h });
      }
      await refetch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message.slice(0, 80) : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!vault) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Create your vault to auto-rebalance this pair.
      </p>
    );
  }

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {allowed ? (
        <div className="flex items-center justify-between gap-2">
          <Badge variant="success" className="text-[10px]">
            Auto-rebalance ON{trusted ? " · trusted quote" : " · oracle"}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setBoth(false)}
            className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
          >
            {busy ? "…" : "Disable"}
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {!hasOracle && (
            <label className="flex items-start gap-1.5 text-[10px] leading-snug text-amber-700">
              <input
                type="checkbox"
                checked={trust}
                onChange={(e) => setTrust(e.target.checked)}
                className="mt-0.5"
              />
              No oracle — I trust the service&apos;s quote for {sym1}⟷{sym2}.
            </label>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => setBoth(true)}
            className="h-7 w-full text-[11px]"
          >
            {busy ? "…" : "Allow auto-rebalance (both ways)"}
          </Button>
        </div>
      )}
      {err && <p className="text-[10px] text-destructive">{err}</p>}
    </div>
  );
}
