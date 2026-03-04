"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useSendTransaction,
} from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { erc20Abi } from "viem";
import { base } from "viem/chains";
import { TOKENS, REBALANCER_VAULT_ADDRESS } from "@/lib/constants";
import { VAULT_ABI } from "@/lib/vault-abi";

const WETH_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;

type ManualRebalanceProps = {
  fromToken: string;
  toToken: string;
  fromSym: string;
  toSym: string;
  fromPrice: number;
  toPrice: number;
  fromDecimals: number;
  toDecimals: number;
};

type LiFiQuote = {
  tool: string;
  toAmount: string;
  toAmountMin: string;
  approvalAddress: string;
  gasCostUSD: string;
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  };
};

export function ManualRebalance({
  fromToken,
  toToken,
  fromSym,
  toSym,
  fromPrice,
  toPrice,
  fromDecimals,
  toDecimals,
}: ManualRebalanceProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<LiFiQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);

  const { address } = useAccount();
  const amountNum = parseFloat(amount) || 0;
  const estimatedOut = toPrice > 0 ? (amountNum * fromPrice) / toPrice : 0;

  const amountInWei =
    amountNum > 0 ? parseUnits(amount, fromDecimals) : 0n;

  // Fetch LI.FI quote when amount changes (debounced)
  const fetchQuote = useCallback(async () => {
    if (!address || amountNum <= 0) {
      setQuote(null);
      return;
    }

    setQuoteLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        fromToken: fromToken.toLowerCase(),
        toToken: toToken.toLowerCase(),
        fromAmount: amountInWei.toString(),
        fromAddress: address,
      });

      const resp = await fetch(`/api/swap/quote?${params.toString()}`);

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(
          data.detail || data.error || `Quote failed (${resp.status})`
        );
      }

      const data = await resp.json();

      if (data.estimate && data.transactionRequest) {
        const gasCostUSD =
          data.estimate.gasCosts?.[0]?.amountUSD ?? "0";

        setQuote({
          tool: data.tool || "unknown",
          toAmount: data.estimate.toAmount,
          toAmountMin: data.estimate.toAmountMin,
          approvalAddress: data.estimate.approvalAddress,
          gasCostUSD,
          transactionRequest: {
            to: data.transactionRequest.to,
            data: data.transactionRequest.data,
            value: data.transactionRequest.value,
            gasLimit: data.transactionRequest.gasLimit,
          },
        });
      } else {
        setQuote(null);
        setError(
          "Route not found. Possibly insufficient liquidity."
        );
      }
    } catch (err) {
      console.error("Quote error:", err);
      setQuote(null);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No available quotes")) {
        setError("No routes available for this token pair.");
      } else {
        setError(msg.length > 200 ? msg.slice(0, 200) + "…" : msg);
      }
    } finally {
      setQuoteLoading(false);
    }
  }, [address, amountNum, fromToken, toToken, amountInWei]);

  // Debounce quote fetching
  useEffect(() => {
    if (amountNum <= 0 || !address) {
      setQuote(null);
      return;
    }

    const timer = setTimeout(fetchQuote, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, fromToken, toToken, address]);

  const outFormatted = quote?.toAmount
    ? formatUnits(BigInt(quote.toAmount), toDecimals)
    : null;

  // Allowance: check approval for LI.FI Diamond
  const approvalAddr = quote?.approvalAddress as `0x${string}` | undefined;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: fromToken as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      address && approvalAddr ? [address, approvalAddr] : undefined,
    query: { enabled: !!address && !!approvalAddr },
  });

  const { data: ethBalance } = useBalance({ address, chainId: base.id });
  const { data: wethBalance } = useReadContract({
    address: TOKENS.WETH as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  // Wallet balance of fromToken (for validation)
  const { data: walletBalanceRaw } = useReadContract({
    address: fromToken as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const walletBalance = (walletBalanceRaw as bigint | undefined) ?? 0n;
  const walletBalanceNum = Number(formatUnits(walletBalance, fromDecimals));

  // Vault balance of fromToken (to show warning)
  const vaultAddr = REBALANCER_VAULT_ADDRESS as `0x${string}`;
  const { data: vaultBalanceRaw } = useReadContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "balances",
    args: address ? [address, fromToken as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });
  const vaultBalance = (vaultBalanceRaw as bigint | undefined) ?? 0n;
  const vaultBalanceNum = Number(formatUnits(vaultBalance, fromDecimals));

  const insufficientWallet = amountInWei > 0n && walletBalance < amountInWei;
  const hasVaultBalance = vaultBalanceNum > 0;

  const nativeEthWei = ethBalance?.value ?? 0n;
  const wrappedWei = (wethBalance as bigint | undefined) ?? 0n;
  const isFromWeth =
    fromToken.toLowerCase() === TOKENS.WETH.toLowerCase();
  const needsWrap =
    isFromWeth &&
    amountInWei > 0n &&
    wrappedWei < amountInWei &&
    nativeEthWei >= amountInWei;

  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { sendTransactionAsync, isPending: isSendPending } =
    useSendTransaction();

  const needsApproval =
    allowance !== undefined &&
    amountInWei > 0n &&
    (allowance as bigint) < amountInWei;

  const handleRebalance = async () => {
    if (!address || amountNum <= 0 || !publicClient || !quote) return;
    setError(null);
    setSwapping(true);

    try {
      // Step 1: Wrap ETH → WETH if needed
      if (needsWrap) {
        const wrapHash = await writeContractAsync({
          address: TOKENS.WETH as `0x${string}`,
          abi: WETH_ABI,
          functionName: "deposit",
          value: amountInWei,
        });
        if (wrapHash) {
          await publicClient.waitForTransactionReceipt({
            hash: wrapHash,
          });
        }
      }

      // Step 2: Approve LI.FI Diamond if needed
      if (needsApproval && approvalAddr) {
        const approveHash = await writeContractAsync({
          address: fromToken as `0x${string}`,
          abi: erc20Abi,
          functionName: "approve",
          args: [
            approvalAddr,
            0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
          ],
        });
        if (approveHash) {
          await publicClient.waitForTransactionReceipt({
            hash: approveHash,
          });
          refetchAllowance();
        }
      }

      // Step 3: Send the swap transaction from LI.FI
      const tx = quote.transactionRequest;
      const hash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : 0n,
        gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      });

      if (hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setAmount("");
      setQuote(null);
    } catch (err: unknown) {
      console.error("Rebalance error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("rejected")) {
        setError("Transaction rejected by user");
      } else if (msg.includes("insufficient")) {
        setError("Insufficient tokens to swap");
      } else if (
        msg.includes("TRANSFER_FROM_FAILED") ||
        msg.includes("allowance")
      ) {
        setError("Approval needed — try again");
      } else {
        setError(
          msg.length > 200 ? msg.slice(0, 200) + "…" : msg
        );
      }
    } finally {
      setSwapping(false);
    }
  };

  const isButtonDisabled =
    !address ||
    amountNum <= 0 ||
    !quote ||
    !publicClient ||
    isPending ||
    isSendPending ||
    swapping ||
    (insufficientWallet && !needsWrap);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-4 text-lg font-semibold text-white">
        Manual rebalance
      </h3>
      <p className="mb-2 text-sm text-white/60">
        Swap: {fromSym} → {toSym}
      </p>
      <p className="mb-4 text-xs text-white/40">
        Route via LI.FI (DEX aggregator)
        {quote?.tool && (
          <span className="ml-1 text-white/50">
            · {quote.tool}
          </span>
        )}
      </p>
      {needsWrap && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          You have native ETH. It will be wrapped to WETH first, then
          the swap will execute.
        </p>
      )}
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-white/60">
            Amount {fromSym}
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white placeholder:text-white/40"
          />
        </div>
        {amountNum > 0 && (
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
            {quoteLoading ? (
              <span className="text-white/50">
                Fetching quote from LI.FI…
              </span>
            ) : outFormatted ? (
              <>
                ≈ {amountNum.toFixed(2)} {fromSym} → ≈{" "}
                {Number(outFormatted).toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                })}{" "}
                {toSym}
                {quote?.gasCostUSD &&
                  parseFloat(quote.gasCostUSD) > 0 && (
                    <span className="ml-2 text-white/40">
                      (gas ≈ ${parseFloat(quote.gasCostUSD).toFixed(4)})
                    </span>
                  )}
              </>
            ) : (
              <>
                ≈ {amountNum.toFixed(2)} {fromSym} → ≈{" "}
                {estimatedOut.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                })}{" "}
                {toSym}
                <span className="ml-2 text-white/40">
                  (price estimate)
                </span>
              </>
            )}
          </div>
        )}
        {insufficientWallet && !needsWrap && amountNum > 0 && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <p className="font-medium">
              ⚠ Not enough {fromSym} in wallet
            </p>
            <p className="mt-1 text-xs text-red-300/80">
              In wallet: {walletBalanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} {fromSym}
              {hasVaultBalance && (
                <>
                  {" "}· In Vault: {vaultBalanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} {fromSym}
                </>
              )}
            </p>
            {hasVaultBalance && (
              <p className="mt-1 text-xs text-red-300/60">
                For manual swap, tokens must be in your wallet, not in Vault.
                Withdraw from Vault first.
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          disabled={isButtonDisabled}
          onClick={handleRebalance}
          className="w-full rounded-lg bg-[#0052FF] py-3 font-medium text-white transition hover:bg-[#0046e0] disabled:opacity-50"
        >
          {isPending || isSendPending || swapping
            ? "Waiting for confirmation…"
            : needsWrap
              ? "Wrap ETH to WETH and rebalance"
              : needsApproval
                ? "Approve and rebalance"
                : "Rebalance (confirm in wallet)"}
        </button>
        {amountNum > 0 &&
          !quote &&
          !quoteLoading &&
          !error && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Route not found. Possibly insufficient
              liquidity for this pair.
            </div>
          )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <p className="text-xs text-white/50">
          Connect wallet and confirm the transaction. Tokens
          remain in your custody.
        </p>
      </div>
    </div>
  );
}
