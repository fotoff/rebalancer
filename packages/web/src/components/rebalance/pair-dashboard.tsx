"use client";

import { useState } from "react";
import Image from "next/image";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { erc20Abi } from "viem";
import { base } from "viem/chains";
import { useQueryClient } from "@tanstack/react-query";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { useTokenMeta } from "@/hooks/use-token-meta";
import { useTokenInfo } from "@/hooks/use-token-info";
import { useVaultBalances } from "@/hooks/use-vault-balances";
import { TOKENS } from "@/lib/constants";
import { DirectionToggle } from "./direction-toggle";
import { TriggerForm } from "./trigger-form";
import { VaultPanel } from "./vault-panel";
import { ManualRebalance } from "./manual-rebalance";
import { PriceChart } from "./price-chart";
import { AiAdvisor } from "./ai-advisor";

/* ---------- Price change badge (like on portfolio page) ---------- */
function PriceChangeBadge({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  if (value == null) return null;
  const isPositive = value > 0;
  const isZero = value === 0;
  const color = isZero
    ? "text-white/50"
    : isPositive
      ? "text-emerald-400"
      : "text-red-400";
  return (
    <span className={`text-xs ${color}`}>
      {label}:{" "}
      <span className="font-medium">
        {isPositive ? "+" : ""}
        {value.toFixed(2)}%
      </span>
    </span>
  );
}

/* ---------- Token logo with coloured-circle fallback ---------- */
function TokenLogo({
  src,
  symbol,
  size = 36,
}: {
  src: string | null | undefined;
  symbol: string;
  size?: number;
}) {
  if (!src) {
    const charCode = symbol.charCodeAt(0) || 65;
    const hue = (charCode * 47) % 360;
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: `hsl(${hue}, 50%, 35%)`,
        }}
      >
        {symbol.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={symbol}
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
      unoptimized
    />
  );
}

/* ---------- Main component ---------- */
type PairDashboardProps = {
  token1: string;
  token2: string;
  onBack: () => void;
};

export function PairDashboard({ token1, token2, onBack }: PairDashboardProps) {
  const [direction, setDirection] = useState<"1to2" | "2to1">("1to2");
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const sortedPairId = [token1, token2].map((a) => a.toLowerCase()).sort().join("-");
  const addrs = [token1, token2].map((a) => a.toLowerCase());
  const { data: prices } = useTokenPrices(addrs);
  const { data: tokenMeta } = useTokenMeta(addrs);

  const { data: ethBalance } = useBalance({ address, chainId: base.id });

  // Read balanceOf for both tokens on-chain
  const { data: contractData } = useReadContracts({
    contracts: [
      { address: token1 as `0x${string}`, abi: erc20Abi, functionName: "balanceOf" as const, args: address ? [address] : undefined },
      { address: token2 as `0x${string}`, abi: erc20Abi, functionName: "balanceOf" as const, args: address ? [address] : undefined },
    ],
    query: { enabled: !!address },
  });

  const balances = contractData ? [contractData[0], contractData[1]] : undefined;

  // Resolve symbol & decimals (KNOWN_TOKENS cache + on-chain ERC-20 fallback)
  const { getSymbol, getDecimals } = useTokenInfo([token1, token2]);

  const p1 = prices?.[token1.toLowerCase()] ?? 0;
  const p2 = prices?.[token2.toLowerCase()] ?? 0;
  const ratio = p2 > 0 ? p1 / p2 : 0;

  const sym1 = getSymbol(token1);
  const sym2 = getSymbol(token2);
  const dec1 = getDecimals(token1);
  const dec2 = getDecimals(token2);

  // Shared vault balances (single source of truth via VaultBalancesProvider)
  const { vaultBalances: vaultBalancesRaw, refetchVault } = useVaultBalances([token1, token2]);
  const vaultBal1Raw = vaultBalancesRaw[token1.toLowerCase()] ?? 0n;
  const vaultBal2Raw = vaultBalancesRaw[token2.toLowerCase()] ?? 0n;

  const bal1 = balances?.[0]?.result as bigint | undefined;
  const bal2 = balances?.[1]?.result as bigint | undefined;
  const nativeEth = ethBalance?.value
    ? Number(formatUnits(ethBalance.value, 18))
    : 0;
  const bal1Num = bal1 ? Number(formatUnits(bal1, dec1)) : 0;
  const bal2Num = bal2 ? Number(formatUnits(bal2, dec2)) : 0;
  const vaultBal1 = vaultBal1Raw ? Number(formatUnits(vaultBal1Raw, dec1)) : 0;
  const vaultBal2 = vaultBal2Raw ? Number(formatUnits(vaultBal2Raw, dec2)) : 0;
  const isWeth1 = token1.toLowerCase() === TOKENS.WETH.toLowerCase();
  const isWeth2 = token2.toLowerCase() === TOKENS.WETH.toLowerCase();
  const hasWethInPair = isWeth1 || isWeth2;

  const fromToken = direction === "1to2" ? token1 : token2;
  const toToken = direction === "1to2" ? token2 : token1;
  const fromSym = direction === "1to2" ? sym1 : sym2;
  const toSym = direction === "1to2" ? sym2 : sym1;

  const meta1 = tokenMeta?.[token1.toLowerCase()];
  const meta2 = tokenMeta?.[token2.toLowerCase()];
  const logo1 = meta1?.logoURI ?? null;
  const logo2 = meta2?.logoURI ?? null;

  // USD value of each token holding (wallet + vault, for WETH include native ETH)
  const effectiveBal1 = (isWeth1 ? nativeEth + bal1Num : bal1Num) + vaultBal1;
  const effectiveBal2 = (isWeth2 ? nativeEth + bal2Num : bal2Num) + vaultBal2;
  const usd1 = effectiveBal1 * p1;
  const usd2 = effectiveBal2 * p2;
  const totalUsd = usd1 + usd2;
  const pct1 = totalUsd > 0 ? (usd1 / totalUsd) * 100 : 0;
  const pct2 = totalUsd > 0 ? (usd2 / totalUsd) * 100 : 0;

  // Ratio follows the current direction: "1 fromSym = X toSym"
  const displayRatio =
    direction === "1to2"
      ? ratio                         // p1/p2
      : p1 > 0 ? p2 / p1 : 0;        // p2/p1

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="text-sm text-white/60 hover:text-white"
      >
        ← Back to pairs
      </button>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Pair: {sym1} ⟷ {sym2}
        </h2>

        {/* Direction toggle (single button) + ratio */}
        <DirectionToggle
          fromSym={fromSym}
          toSym={toSym}
          direction={direction}
          onChange={setDirection}
          displayRatio={displayRatio}
        />

        <div className="mt-6 space-y-4">
          {/* Token cards: icon + price + balance + full contract link */}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* ---- Token 1 card ---- */}
            <div className="rounded-lg border border-white/10 bg-black/30 p-4">
              <div className="flex items-center gap-3">
                <TokenLogo src={logo1} symbol={sym1} />
                <div>
                  <p className="font-medium text-white">{sym1}</p>
                  <p className="text-lg font-semibold text-white">
                    ${p1.toFixed(p1 >= 1 ? 2 : 6)}
                  </p>
                  <div className="flex items-center gap-3">
                    <PriceChangeBadge label="1h" value={meta1?.priceChange1h} />
                    <PriceChangeBadge label="24h" value={meta1?.priceChange24h} />
                  </div>
                </div>
              </div>

              {address ? (
                <>
                  {isWeth1 ? (
                    <div className="mt-3 space-y-1 text-sm text-white/70">
                      <p>ETH: {nativeEth.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                      <p>WETH: {bal1Num.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                      {vaultBal1 > 0 && (
                        <p className="text-cyan-400/80">
                          Vault: {vaultBal1.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-1">
                      <p className="text-sm text-white/70">
                        Wallet: {bal1Num.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </p>
                      {vaultBal1 > 0 && (
                        <p className="text-sm text-cyan-400/80">
                          Vault: {vaultBal1.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-white/80">
                      ≈ $
                      {usd1.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-medium text-white/60">
                      {pct1.toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-white/50">—</p>
              )}

              <a
                href={`https://basescan.org/token/${token1}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center gap-1 break-all font-mono text-xs text-white/40 hover:text-[#0052FF] hover:underline"
                title={token1}
              >
                {token1}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>

            {/* ---- Token 2 card ---- */}
            <div className="rounded-lg border border-white/10 bg-black/30 p-4">
              <div className="flex items-center gap-3">
                <TokenLogo src={logo2} symbol={sym2} />
                <div>
                  <p className="font-medium text-white">{sym2}</p>
                  <p className="text-lg font-semibold text-white">
                    ${p2.toFixed(p2 >= 1 ? 2 : 6)}
                  </p>
                  <div className="flex items-center gap-3">
                    <PriceChangeBadge label="1h" value={meta2?.priceChange1h} />
                    <PriceChangeBadge label="24h" value={meta2?.priceChange24h} />
                  </div>
                </div>
              </div>

              {address ? (
                <>
                  {isWeth2 ? (
                    <div className="mt-3 space-y-1 text-sm text-white/70">
                      <p>ETH: {nativeEth.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                      <p>WETH: {bal2Num.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                      {vaultBal2 > 0 && (
                        <p className="text-cyan-400/80">
                          Vault: {vaultBal2.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-1">
                      <p className="text-sm text-white/70">
                        Wallet: {bal2Num.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </p>
                      {vaultBal2 > 0 && (
                        <p className="text-sm text-cyan-400/80">
                          Vault: {vaultBal2.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-white/80">
                      ≈ $
                      {usd2.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-medium text-white/60">
                      {pct2.toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-white/50">—</p>
              )}

              <a
                href={`https://basescan.org/token/${token2}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center gap-1 break-all font-mono text-xs text-white/40 hover:text-[#0052FF] hover:underline"
                title={token2}
              >
                {token2}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          </div>

          {/* Allocation bar */}
          {address && totalUsd > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-white/50">
                <span>
                  {sym1} — {pct1.toFixed(1)}%
                </span>
                <span>
                  Total: $
                  {totalUsd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span>
                  {pct2.toFixed(1)}% — {sym2}
                </span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="bg-[#0052FF] transition-all duration-500"
                  style={{ width: `${pct1}%` }}
                />
                <div
                  className="bg-[#d48beb] transition-all duration-500"
                  style={{ width: `${pct2}%` }}
                />
              </div>
            </div>
          )}

          {/* Price chart */}
          <PriceChart token1={token1} token2={token2} symbol1={sym1} symbol2={sym2} />

          {/* WETH warning — moved to bottom of the pair block */}
          {hasWethInPair && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              For swapping you need <strong>WETH</strong>. If you only have
              ETH — it will be wrapped to WETH when you tap Rebalance.
            </p>
          )}
        </div>
      </div>

      <AiAdvisor
        token1={token1}
        token2={token2}
        sym1={sym1}
        sym2={sym2}
        pairId={sortedPairId}
        vaultBal1={vaultBal1}
        vaultBal2={vaultBal2}
        onTriggersCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["triggers", address, sortedPairId] });
        }}
      />

      <VaultPanel
        token1={token1}
        token2={token2}
        sym1={sym1}
        sym2={sym2}
        dec1={dec1}
        dec2={dec2}
        parentVaultBal1={vaultBal1Raw}
        parentVaultBal2={vaultBal2Raw}
        onVaultChange={refetchVault}
      />

      <TriggerForm
        token1={token1}
        token2={token2}
        fromToken={fromToken}
        toToken={toToken}
        fromSym={fromSym}
        toSym={toSym}
        sym1={sym1}
        sym2={sym2}
        dec1={dec1}
        dec2={dec2}
        price1={p1}
        price2={p2}
        ratio={ratio}
        direction={direction}
        onDirectionChange={setDirection}
        fromBalance={direction === "1to2" ? vaultBal1 : vaultBal2}
      />

      <ManualRebalance
        fromToken={fromToken}
        toToken={toToken}
        fromSym={fromSym}
        toSym={toSym}
        fromPrice={direction === "1to2" ? p1 : p2}
        toPrice={direction === "1to2" ? p2 : p1}
        fromDecimals={direction === "1to2" ? dec1 : dec2}
        toDecimals={direction === "1to2" ? dec2 : dec1}
      />
    </div>
  );
}
