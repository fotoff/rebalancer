"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { VAULT_ABI } from "@/lib/vault-abi";
import { REBALANCER_VAULT_ADDRESS } from "@/lib/constants";

const PERCENT_PRESETS = [25, 50, 75, 100] as const;

type VaultPanelProps = {
  token1: string;
  token2: string;
  sym1: string;
  sym2: string;
  dec1: number;
  dec2: number;
  parentVaultBal1: bigint;
  parentVaultBal2: bigint;
  onVaultChange?: () => void;
};

export function VaultPanel({
  token1,
  token2,
  sym1,
  sym2,
  dec1,
  dec2,
  parentVaultBal1,
  parentVaultBal2,
  onVaultChange,
}: VaultPanelProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  const [action, setAction] = useState<"deposit" | "withdraw">("deposit");
  const [selectedToken, setSelectedToken] = useState<"1" | "2">("1");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const vaultAddr = REBALANCER_VAULT_ADDRESS as `0x${string}`;
  const isVaultConfigured =
    vaultAddr !== "0x0000000000000000000000000000000000000000";

  const token = selectedToken === "1" ? token1 : token2;
  const sym = selectedToken === "1" ? sym1 : sym2;
  const dec = selectedToken === "1" ? dec1 : dec2;

  // Vault balances from parent (single source of truth)
  const vaultBal1 = parentVaultBal1;
  const vaultBal2 = parentVaultBal2;

  // Read wallet balances + allowances (separate from vault balances)
  const { data: walletData, refetch: refetchWallet } = useReadContracts({
    contracts: [
      // wallet balance token1
      {
        address: token1 as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      // wallet balance token2
      {
        address: token2 as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
      // allowance token1 for vault
      {
        address: token1 as `0x${string}`,
        abi: erc20Abi,
        functionName: "allowance",
        args: address ? [address, vaultAddr] : undefined,
      },
      // allowance token2 for vault
      {
        address: token2 as `0x${string}`,
        abi: erc20Abi,
        functionName: "allowance",
        args: address ? [address, vaultAddr] : undefined,
      },
    ],
    query: { enabled: !!address && isVaultConfigured },
  });

  const walletBal1 = (walletData?.[0]?.result as bigint) ?? 0n;
  const walletBal2 = (walletData?.[1]?.result as bigint) ?? 0n;
  const allowance1 = (walletData?.[2]?.result as bigint) ?? 0n;
  const allowance2 = (walletData?.[3]?.result as bigint) ?? 0n;

  const vaultBal1Num = Number(formatUnits(vaultBal1, dec1));
  const vaultBal2Num = Number(formatUnits(vaultBal2, dec2));
  const walletBal1Num = Number(formatUnits(walletBal1, dec1));
  const walletBal2Num = Number(formatUnits(walletBal2, dec2));

  const currentVaultBal = selectedToken === "1" ? vaultBal1 : vaultBal2;
  const currentWalletBal = selectedToken === "1" ? walletBal1 : walletBal2;
  const currentAllowance = selectedToken === "1" ? allowance1 : allowance2;
  const maxBal = action === "deposit" ? currentWalletBal : currentVaultBal;
  const maxBalNum = Number(formatUnits(maxBal, dec));

  const amountNum = parseFloat(amount) || 0;
  const amountWei = amountNum > 0 ? parseUnits(amount, dec) : 0n;
  const needsApproval =
    action === "deposit" && amountWei > 0n && currentAllowance < amountWei;

  const handleAction = async () => {
    if (!address || amountWei <= 0n || !publicClient) return;
    setError(null);
    setSuccess(null);
    setBusy(true);

    try {
      // Approve if needed
      if (needsApproval) {
        const approveHash = await writeContractAsync({
          address: token as `0x${string}`,
          abi: erc20Abi,
          functionName: "approve",
          args: [
            vaultAddr,
            0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
          ],
        });
        if (approveHash) {
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      // Deposit or withdraw
      const hash = await writeContractAsync({
        address: vaultAddr,
        abi: VAULT_ABI,
        functionName: action,
        args: [token as `0x${string}`, amountWei],
      });

      if (hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      // Track event in local history (include pairId so stats are pair-scoped)
      try {
        const pairId = [token1, token2]
          .map((a) => a.toLowerCase())
          .sort()
          .join("-");
        await fetch("/api/vault/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userAddress: address,
            pairId,
            type: action,
            token,
            amount: amountWei.toString(),
            txHash: hash,
          }),
        });
      } catch {
        // non-critical, don't block UI
      }

      setAmount("");
      setSuccess(
        action === "deposit"
          ? `Deposit ${amountNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${sym} completed`
          : `Withdrawal ${amountNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${sym} completed`
      );
      refetchWallet();
      onVaultChange?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("rejected")) {
        setError("Transaction rejected");
      } else {
        setError(msg.length > 150 ? msg.slice(0, 150) + "…" : msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!isVaultConfigured) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-2 text-lg font-semibold text-white">
          Vault (deposit / withdraw)
        </h3>
        <p className="text-sm text-white/50">
          Vault contract not deployed yet. Set NEXT_PUBLIC_VAULT_ADDRESS
          in .env.local after deployment.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-4 text-lg font-semibold text-white">
        Vault (deposit / withdraw)
      </h3>

      {/* Vault balances display */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs text-white/50">{sym1} in Vault</p>
          <p className="text-lg font-semibold text-white">
            {vaultBal1Num.toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}
          </p>
          <p className="text-xs text-white/40">
            Wallet:{" "}
            {walletBal1Num.toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs text-white/50">{sym2} in Vault</p>
          <p className="text-lg font-semibold text-white">
            {vaultBal2Num.toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}
          </p>
          <p className="text-xs text-white/40">
            Wallet:{" "}
            {walletBal2Num.toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}
          </p>
        </div>
      </div>

      {/* Action toggle */}
      <div className="mb-4 flex gap-1 rounded-lg bg-white/5 p-0.5">
        <button
          type="button"
          onClick={() => {
            setAction("deposit");
            setAmount("");
            setError(null);
            setSuccess(null);
          }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            action === "deposit"
              ? "bg-[#0052FF] text-white"
              : "text-white/60 hover:text-white"
          }`}
        >
          Deposit
        </button>
        <button
          type="button"
          onClick={() => {
            setAction("withdraw");
            setAmount("");
            setError(null);
            setSuccess(null);
          }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            action === "withdraw"
              ? "bg-[#0052FF] text-white"
              : "text-white/60 hover:text-white"
          }`}
        >
          Withdraw
        </button>
      </div>

      {/* Token selector */}
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setSelectedToken("1");
            setAmount("");
          }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            selectedToken === "1"
              ? "bg-white/20 text-white"
              : "bg-white/5 text-white/50 hover:bg-white/10"
          }`}
        >
          {sym1}
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedToken("2");
            setAmount("");
          }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            selectedToken === "2"
              ? "bg-white/20 text-white"
              : "bg-white/5 text-white/50 hover:bg-white/10"
          }`}
        >
          {sym2}
        </button>
      </div>

      {/* Percent presets */}
      <div className="mb-3 flex gap-2">
        {PERCENT_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              const val = (maxBalNum * p) / 100;
              setAmount(
                val.toLocaleString("en", {
                  maximumFractionDigits: 18,
                  useGrouping: false,
                })
              );
            }}
            className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50 hover:bg-white/10 hover:text-white/80"
          >
            {p}%
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative w-full">
          <input
            type="number"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
              setSuccess(null);
            }}
            placeholder={
              maxBalNum > 0
                ? maxBalNum.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })
                : "0"
            }
            min={0}
            step="0.000001"
            className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 pr-16 text-white placeholder:text-white/30"
          />
          {maxBalNum > 0 && (
            <button
              type="button"
              onClick={() =>
                setAmount(
                  formatUnits(maxBal, dec)
                )
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-white/60 hover:bg-white/20 hover:text-white"
            >
              MAX
            </button>
          )}
        </div>
        <span className="shrink-0 text-sm text-white/60">{sym}</span>
      </div>

      <p className="mb-3 text-xs text-white/40">
        Available:{" "}
        {maxBalNum.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
        {sym}
        {action === "deposit" ? " (wallet)" : " (vault)"}
      </p>

      {/* Action button */}
      <button
        type="button"
        disabled={!address || amountWei <= 0n || isPending || busy}
        onClick={handleAction}
        className="w-full rounded-lg bg-[#0052FF] py-3 font-medium text-white transition hover:bg-[#0046e0] disabled:opacity-50"
      >
        {isPending || busy
          ? "Waiting for confirmation…"
          : needsApproval
            ? `Approve and ${action === "deposit" ? "deposit" : "withdraw"}`
            : action === "deposit"
              ? `Deposit ${sym} to Vault`
              : `Withdraw ${sym} from Vault`}
      </button>

      {success && (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {success}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
