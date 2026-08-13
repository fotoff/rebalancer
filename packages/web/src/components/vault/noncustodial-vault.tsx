"use client";

import { useState, useMemo } from "react";
import {
  useAccount,
  useBalance,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { useQuery } from "@tanstack/react-query";
import { FACTORY_ABI, USER_VAULT_ABI } from "@/lib/noncustodial-abi";
import { FACTORY_ADDRESS, TOKENS } from "@/lib/constants";
import { useUserVault } from "@/hooks/use-user-vault";
import { usePortfolioTokens } from "@/hooks/use-portfolio-tokens";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Always-available tokens (oracle majors) shown even with a zero balance.
// Base's WETH exposes deposit() on top of the ERC-20 surface.
const WETH_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

// Pseudo-entry so a wallet holding only ETH is not stuck: the vault takes
// ERC-20s only, so ETH is wrapped on the way in.
const ETH_OPTION = {
  address: TOKENS.WETH,
  symbol: "ETH",
  decimals: 18,
  isEth: true,
} as const;

// Leave enough behind for the wrap, the approve and the deposit itself.
const ETH_GAS_BUFFER = parseUnits("0.0003", 18);

const SUPPORTED = [
  { address: TOKENS.WETH, symbol: "WETH", decimals: 18 },
  { address: TOKENS.USDC, symbol: "USDC", decimals: 6 },
] as const;

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function NonCustodialVault() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { factoryConfigured, vaultAddress, hasVault, isLoading, refetch } =
    useUserVault();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stage, setStage] = useState<"confirm" | "mining" | null>(null);
  const [pendingTx, setPendingTx] = useState<`0x${string}` | null>(null);

  if (!factoryConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Non-Custodial Vault</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The factory address is not configured yet
          (NEXT_PUBLIC_FACTORY_ADDRESS).
        </CardContent>
      </Card>
    );
  }

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Non-Custodial Vault</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Connect your wallet to create a personal vault.
        </CardContent>
      </Card>
    );
  }

  async function handleCreate() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    // Two waits, and a user stuck on either deserves to know which one.
    setStage("confirm");
    try {
      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "deployVault",
      });
      setStage("mining");
      setPendingTx(hash);
      // Without a timeout this waits forever on a dropped transaction and the
      // button sits at "Creating…" with nothing to act on.
      await publicClient?.waitForTransactionReceipt({ hash, timeout: 120_000 });
      setSuccess("Your vault is deployed.");
      setPendingTx(null);
      await refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create vault";
      // A timeout is not a failure: the transaction may still land, so say so
      // and leave the hash visible instead of implying it was lost.
      setError(
        /timed out|timeout/i.test(msg)
          ? "Still not confirmed after two minutes. It may yet go through — check the transaction, then reload."
          : /rejected|denied|User rejected/i.test(msg)
            ? "Cancelled in your wallet."
            : msg
      );
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Non-Custodial Vault</CardTitle>
        {hasVault && vaultAddress && (
          <Badge variant="secondary" className="font-mono">
            {short(vaultAddress)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasVault && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Deploy your own vault. Only you can withdraw; our service can only
              swap inside the pairs and price bounds you allow.
            </p>
            <Button onClick={handleCreate} disabled={busy || isLoading}>
              {stage === "confirm"
                ? "Confirm in your wallet…"
                : stage === "mining"
                  ? "Waiting for the network…"
                  : "Create my vault"}
            </Button>
            {stage === "confirm" && (
              <p className="text-xs text-muted-foreground">
                Open your wallet and approve the transaction. Nothing happens
                until you do.
              </p>
            )}
            {pendingTx && (
              <a
                href={`https://basescan.org/tx/${pendingTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Track the transaction on BaseScan
              </a>
            )}
          </div>
        )}

        {hasVault && vaultAddress && (
          <VaultManager
            vault={vaultAddress}
            owner={address}
            onError={setError}
            onSuccess={setSuccess}
          />
        )}

        {error && <p className="text-sm text-destructive break-words">{error}</p>}
        {success && <p className="text-sm text-primary">{success}</p>}
      </CardContent>
    </Card>
  );
}

function VaultManager({
  vault,
  owner,
  onError,
  onSuccess,
}: {
  vault: `0x${string}`;
  owner: `0x${string}`;
  onError: (m: string | null) => void;
  onSuccess: (m: string | null) => void;
}) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [tokenIdx, setTokenIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  // Deposit ANY token the user holds (the vault accepts any ERC20). Build the
  // list from their wallet portfolio + whatever already sits inside the vault.
  const { items: portfolioItems } = usePortfolioTokens();

  const { data: vaultScan = [] } = useQuery({
    queryKey: ["vault-scan-full", vault],
    queryFn: async () => {
      const res = await fetch(`/api/portfolio/scan?address=${vault}&raw=1`);
      if (!res.ok) return [] as Array<{ address: string; symbol: string; decimals: number }>;
      const d = await res.json();
      return (d.tokens ?? []) as Array<{ address: string; symbol: string; decimals: number }>;
    },
    enabled: Boolean(vault),
    staleTime: 30_000,
  });

  const fundTokens = useMemo(() => {
    const map = new Map<
      string,
      { address: `0x${string}`; symbol: string; decimals: number; isEth?: boolean }
    >();
    // Keyed by symbol so ETH and WETH can coexist despite sharing an address.
    map.set("eth", { ...ETH_OPTION });
    for (const t of SUPPORTED) map.set(t.address.toLowerCase(), { ...t });
    for (const it of portfolioItems) {
      if (it.address === "native") continue; // ETH must be wrapped to WETH first
      const addr = it.address.toLowerCase();
      if (!map.has(addr)) {
        map.set(addr, {
          address: it.tokenAddress as `0x${string}`,
          symbol: it.symbol,
          decimals: it.decimals,
        });
      }
    }
    for (const t of vaultScan) {
      const addr = t.address.toLowerCase();
      if (!map.has(addr)) {
        map.set(addr, {
          address: t.address as `0x${string}`,
          symbol: t.symbol,
          decimals: t.decimals,
        });
      }
    }
    return [...map.values()];
  }, [portfolioItems, vaultScan]);

  const token = fundTokens[Math.min(tokenIdx, fundTokens.length - 1)] ?? SUPPORTED[0];

  // Vault balances for all fund tokens + the wallet balance of the selected token.
  const { data: balances, refetch: refetchBalances } = useReadContracts({
    contracts: [
      ...fundTokens.map((t) => ({
        address: t.address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [vault] as const,
      })),
      {
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [owner] as const,
      },
    ],
  });
  // For ETH the ERC-20 read above returns the WETH balance, which is not what
  // the user is about to spend — read the native balance instead.
  const { data: nativeBalance } = useBalance({ address: owner });
  const isEthSelected = Boolean((token as { isEth?: boolean }).isEth);
  const erc20WalletBal = balances?.[fundTokens.length]?.result as
    | bigint
    | undefined;
  const rawEth = nativeBalance?.value ?? 0n;
  const walletBal = isEthSelected
    ? rawEth > ETH_GAS_BUFFER
      ? rawEth - ETH_GAS_BUFFER
      : 0n
    : erc20WalletBal;
  const selIdx = Math.min(tokenIdx, fundTokens.length - 1);
  const vaultBalRaw = balances?.[selIdx]?.result as bigint | undefined;
  const vaultStr = vaultBalRaw != null ? formatUnits(vaultBalRaw, token.decimals) : "0";
  const walletStr = walletBal != null ? formatUnits(walletBal, token.decimals) : "0";

  async function deposit() {
    onError(null);
    onSuccess(null);
    if (!amount || Number(amount) <= 0) return onError("Enter an amount");
    setBusy(true);
    try {
      const value = parseUnits(amount, token.decimals);

      // ETH cannot sit in the vault, so wrap it first — one extra confirmation.
      if ((token as { isEth?: boolean }).isEth) {
        const wrapHash = await writeContractAsync({
          address: TOKENS.WETH,
          abi: WETH_ABI,
          functionName: "deposit",
          value,
        });
        await publicClient?.waitForTransactionReceipt({ hash: wrapHash });
      }

      const approveHash = await writeContractAsync({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [vault, value],
      });
      await publicClient?.waitForTransactionReceipt({ hash: approveHash });
      const hash = await writeContractAsync({
        address: vault,
        abi: USER_VAULT_ABI,
        functionName: "deposit",
        args: [token.address, value],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      onSuccess(`Deposited ${amount} ${token.symbol}`);
      setAmount("");
      await refetchBalances();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    onError(null);
    onSuccess(null);
    if (!amount || Number(amount) <= 0) return onError("Enter an amount");
    setBusy(true);
    try {
      const value = parseUnits(amount, token.decimals);
      const hash = await writeContractAsync({
        address: vault,
        abi: USER_VAULT_ABI,
        functionName: "withdraw",
        args: [token.address, value],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      onSuccess(`Withdrew ${amount} ${token.symbol}`);
      setAmount("");
      await refetchBalances();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <select
        className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
        value={selIdx}
        onChange={(e) => {
          setTokenIdx(Number(e.target.value));
          setAmount("");
        }}
      >
        {fundTokens.map((t, i) => {
          const vb = balances?.[i]?.result as bigint | undefined;
          return (
            <option key={t.address} value={i}>
              {t.symbol} — {vb != null ? formatUnits(vb, t.decimals) : "0"} in vault
            </option>
          );
        })}
      </select>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => setAmount(vaultStr)}
          className="hover:text-foreground hover:underline"
          title="Use vault balance (max to withdraw)"
        >
          Vault: {vaultStr}
        </button>
        <button
          type="button"
          onClick={() => setAmount(walletStr)}
          className="hover:text-foreground hover:underline"
          title="Use wallet balance (max to deposit)"
        >
          Wallet: {walletStr}
        </button>
      </div>

      <div className="relative">
        <Input
          placeholder={`Amount of ${token.symbol}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="pr-14"
        />
        <button
          type="button"
          onClick={() => setAmount(walletStr)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Max
        </button>
      </div>

      <div className="flex gap-2">
        <Button onClick={deposit} disabled={busy} className="h-9 flex-1">
          {busy ? "…" : "Deposit"}
        </Button>
        <Button onClick={withdraw} disabled={busy} variant="secondary" className="h-9 flex-1">
          {busy ? "…" : "Withdraw"}
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Deposit any token. Allow auto-rebalance per pair from the &quot;My
        pairs&quot; cards below. Withdraw is always available.
      </p>
    </div>
  );
}
