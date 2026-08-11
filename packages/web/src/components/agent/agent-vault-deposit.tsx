"use client";

import { useState } from "react";
import {
  useAccount,
  useBalance,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { TOKENS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Base's WETH exposes deposit()/withdraw() on top of the ERC20 surface.
const WETH_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

/** Tokens depositable into an agent vault. ETH is wrapped on the way in. */
const OPTIONS = [
  { key: "ETH", symbol: "ETH", address: TOKENS.WETH, decimals: 18, wrap: true },
  { key: "WETH", symbol: "WETH", address: TOKENS.WETH, decimals: 18, wrap: false },
  { key: "USDC", symbol: "USDC", address: TOKENS.USDC, decimals: 6, wrap: false },
  { key: "RNBW", symbol: "RNBW", address: TOKENS.RNBW, decimals: 18, wrap: false },
  { key: "OWB", symbol: "OWB", address: TOKENS.OWB, decimals: 18, wrap: false },
] as const;

// Leave enough ETH behind to pay for the deposit itself and a few agent calls.
const ETH_GAS_BUFFER = parseUnits("0.0002", 18);

export function AgentVaultDeposit({
  vault,
  onDeposited,
}: {
  vault: `0x${string}`;
  onDeposited: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [idx, setIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const opt = OPTIONS[idx];

  const { data: ethBalance, refetch: refetchEth } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  const { data: tokenBalances, refetch: refetchTokens } = useReadContracts({
    contracts: OPTIONS.filter((o) => !o.wrap).map((o) => ({
      address: o.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address ?? "0x0"] as const,
    })),
    query: { enabled: Boolean(address) },
  });

  // Wallet balance of whatever is selected.
  const walletBalance: bigint = opt.wrap
    ? (ethBalance?.value ?? 0n)
    : ((tokenBalances?.[
        OPTIONS.filter((o) => !o.wrap).findIndex((o) => o.key === opt.key)
      ]?.result as bigint | undefined) ?? 0n);

  const spendable = opt.wrap
    ? walletBalance > ETH_GAS_BUFFER
      ? walletBalance - ETH_GAS_BUFFER
      : 0n
    : walletBalance;

  async function deposit() {
    setErr(null);
    setNote(null);
    let value: bigint;
    try {
      value = parseUnits(amount, opt.decimals);
    } catch {
      setErr("Enter a valid amount");
      return;
    }
    if (value <= 0n) {
      setErr("Enter an amount above zero");
      return;
    }
    if (value > spendable) {
      setErr(
        opt.wrap
          ? "Not enough ETH once gas is set aside"
          : `Not enough ${opt.symbol}`
      );
      return;
    }

    setBusy(true);
    try {
      // ETH cannot sit in the vault, so wrap it first — one extra transaction.
      if (opt.wrap) {
        setNote("1/2 — wrapping ETH into WETH…");
        const wrapHash = await writeContractAsync({
          address: TOKENS.WETH,
          abi: WETH_ABI,
          functionName: "deposit",
          value,
        });
        await publicClient?.waitForTransactionReceipt({ hash: wrapHash });
      }

      // A plain transfer is enough: the vault reads its own balance, it keeps no
      // internal ledger. That saves the approve step deposit() would need.
      setNote(opt.wrap ? "2/2 — sending WETH to the vault…" : "Sending…");
      const hash = await writeContractAsync({
        address: opt.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [vault, value],
      });
      await publicClient?.waitForTransactionReceipt({ hash });

      setAmount("");
      setNote(null);
      await Promise.all([refetchEth(), refetchTokens()]);
      onDeposited();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message.slice(0, 120) : "Failed");
      setNote(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fund the vault</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Token
            </label>
            <select
              value={idx}
              onChange={(e) => {
                setIdx(Number(e.target.value));
                setAmount("");
                setErr(null);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {OPTIONS.map((o, i) => (
                <option key={o.key} value={i}>
                  {o.key}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Amount</span>
              <button
                type="button"
                onClick={() =>
                  setAmount(formatUnits(spendable, opt.decimals))
                }
                className="text-foreground hover:underline"
              >
                Max{" "}
                {Number(formatUnits(spendable, opt.decimals)).toLocaleString(
                  undefined,
                  { maximumFractionDigits: 6 }
                )}
              </button>
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
            />
          </div>
        </div>

        {opt.wrap && (
          <p className="text-[11px] text-muted-foreground">
            The vault holds ERC-20s only, so this wraps your ETH into WETH first
            — two transactions. A little ETH is kept back for gas.
          </p>
        )}

        <Button onClick={deposit} disabled={busy || !amount} className="w-full">
          {busy ? (note ?? "Confirming…") : `Deposit ${opt.key}`}
        </Button>

        {note && !busy && (
          <p className="text-[11px] text-muted-foreground">{note}</p>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
