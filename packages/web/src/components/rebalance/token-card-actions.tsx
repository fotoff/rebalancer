"use client";

import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContracts,
  useWriteContract,
} from "wagmi";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { USER_VAULT_ABI } from "@/lib/noncustodial-abi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManualRebalance } from "./manual-rebalance";

type TokenInfo = { address: `0x${string}`; symbol: string; decimals: number };

/**
 * Compact per-token actions embedded inside a pair's token card:
 * Deposit / Withdraw (personal vault) + Swap → the counterpart token (LI.FI).
 */
export function TokenCardActions({
  token,
  counter,
  vault,
  fromPrice,
  toPrice,
  onChange,
}: {
  token: TokenInfo;
  counter: TokenInfo;
  vault: `0x${string}` | null;
  fromPrice: number;
  toPrice: number;
  onChange?: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [tab, setTab] = useState<"deposit" | "withdraw" | "swap">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const { data, refetch } = useReadContracts({
    contracts: [
      { address: token.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
      { address: token.address, abi: erc20Abi, functionName: "balanceOf", args: vault ? [vault] : undefined },
      { address: token.address, abi: erc20Abi, functionName: "allowance", args: address && vault ? [address, vault] : undefined },
    ],
    query: { enabled: Boolean(address && vault) },
  });
  const walletRaw = (data?.[0]?.result as bigint) ?? 0n;
  const vaultRaw = (data?.[1]?.result as bigint) ?? 0n;
  const allowance = (data?.[2]?.result as bigint) ?? 0n;
  const walletStr = formatUnits(walletRaw, token.decimals);
  const vaultStr = formatUnits(vaultRaw, token.decimals);

  if (!vault) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
        Create your vault (top of page) to deposit {token.symbol}.
      </p>
    );
  }

  async function run() {
    if (!amount || Number(amount) <= 0) {
      setMsg({ type: "err", text: "Enter an amount" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const value = parseUnits(amount, token.decimals);
      let txHash: `0x${string}` | undefined;
      if (tab === "deposit") {
        if (allowance < value) {
          const ah = await writeContractAsync({ address: token.address, abi: erc20Abi, functionName: "approve", args: [vault!, value] });
          await publicClient?.waitForTransactionReceipt({ hash: ah });
        }
        txHash = await writeContractAsync({ address: vault!, abi: USER_VAULT_ABI, functionName: "deposit", args: [token.address, value] });
        await publicClient?.waitForTransactionReceipt({ hash: txHash });
        setMsg({ type: "ok", text: `Deposited ${amount} ${token.symbol}` });
      } else {
        txHash = await writeContractAsync({ address: vault!, abi: USER_VAULT_ABI, functionName: "withdraw", args: [token.address, value] });
        await publicClient?.waitForTransactionReceipt({ hash: txHash });
        setMsg({ type: "ok", text: `Withdrew ${amount} ${token.symbol}` });
      }
      // Record for the pair's "Rebalance stats" (deposited/withdrawn totals).
      if (txHash && address) {
        const pairId = [token.address, counter.address]
          .map((a) => a.toLowerCase())
          .sort()
          .join("-");
        fetch("/api/vault/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userAddress: address,
            pairId,
            type: tab,
            token: token.address,
            amount: value.toString(),
            txHash,
          }),
        }).catch(() => {});
      }
      setAmount("");
      await refetch();
      onChange?.();
    } catch (e: unknown) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5 text-xs">
        {(["deposit", "withdraw", "swap"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setMsg(null);
            }}
            className={`rounded px-2 py-1 capitalize ${
              tab === t ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
            }`}
          >
            {t === "swap" ? `Swap → ${counter.symbol}` : t}
          </button>
        ))}
      </div>

      {tab !== "swap" ? (
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <button onClick={() => setAmount(vaultStr)} className="hover:text-foreground hover:underline">
              Vault: {vaultStr}
            </button>
            <button onClick={() => setAmount(walletStr)} className="hover:text-foreground hover:underline">
              Wallet: {walletStr}
            </button>
          </div>
          <div className="relative">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Amount of ${token.symbol}`}
              inputMode="decimal"
              className="h-8 pr-12 text-sm"
            />
            <button
              type="button"
              onClick={() => setAmount(tab === "deposit" ? walletStr : vaultStr)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Max
            </button>
          </div>
          <Button onClick={run} disabled={busy} className="h-8 w-full text-sm">
            {busy ? "…" : tab === "deposit" ? `Deposit ${token.symbol}` : `Withdraw ${token.symbol}`}
          </Button>
          {msg && (
            <p className={`break-words text-[11px] ${msg.type === "ok" ? "text-primary" : "text-destructive"}`}>
              {msg.text}
            </p>
          )}
        </div>
      ) : (
        <ManualRebalance
          compact
          fromToken={token.address}
          toToken={counter.address}
          fromSym={token.symbol}
          toSym={counter.symbol}
          fromPrice={fromPrice}
          toPrice={toPrice}
          fromDecimals={token.decimals}
          toDecimals={counter.decimals}
        />
      )}
    </div>
  );
}
