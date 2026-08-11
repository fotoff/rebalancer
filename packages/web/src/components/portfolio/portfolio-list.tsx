"use client";

import { useState } from "react";
import Image from "next/image";
import { useAccount, useReadContracts } from "wagmi";
import { formatUnits, erc20Abi } from "viem";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { usePortfolioTokens } from "@/hooks/use-portfolio-tokens";
import { useTokenMeta } from "@/hooks/use-token-meta";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { useVaultBalances } from "@/hooks/use-vault-balances";
import { useTokenInfo } from "@/hooks/use-token-info";
import { useUserVault } from "@/hooks/use-user-vault";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/utils";

type PortfolioListProps = {
  onAddToPair?: (tokenAddress: string) => void;
};

const FALLBACK_LOGOS: Record<string, string> = {
  native: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
};

function PriceChangeCell({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const isPositive = value > 0;
  const isZero = value === 0;
  const color = isZero
    ? "text-muted-foreground"
    : isPositive
      ? "text-emerald-600"
      : "text-red-600";
  return (
    <span className={color}>
      {isPositive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function TokenLogo({
  src,
  symbol,
}: {
  src: string | null | undefined;
  symbol: string;
}) {
  if (!src) {
    const charCode = symbol.charCodeAt(0) || 65;
    const hue = (charCode * 47) % 360;
    return (
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ backgroundColor: `hsl(${hue}, 50%, 45%)` }}
      >
        {symbol.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={symbol}
      width={28}
      height={28}
      className="h-7 w-7 shrink-0 rounded-full"
      unoptimized
    />
  );
}

function resolveVaultAddr(address: string): string {
  return address === "native"
    ? "0x4200000000000000000000000000000000000006"
    : address.toLowerCase();
}

function VaultBalanceHint({
  address,
  vaultBalances,
}: {
  address: string;
  vaultBalances: Record<string, number>;
}) {
  const vBal = vaultBalances[resolveVaultAddr(address)];
  if (!vBal || vBal <= 0) return null;
  return (
    <div className="text-[10px] text-cyan-600">
      + {vBal.toLocaleString(undefined, { maximumFractionDigits: 4 })} in vault
    </div>
  );
}

function TotalValueCell({
  address,
  usdValue,
  price,
  vaultBalances,
}: {
  address: string;
  usdValue: number;
  price: number;
  vaultBalances: Record<string, number>;
}) {
  const vBal = vaultBalances[resolveVaultAddr(address)] ?? 0;
  const vUsd = vBal * price;
  const totalUsdItem = usdValue + vUsd;
  return (
    <div>
      <span className="text-foreground">
        {formatUsd(totalUsdItem)}
      </span>
      {vUsd > 0.01 && (
        <div className="text-[10px] text-cyan-600">
          vault: {formatUsd(vUsd)}
        </div>
      )}
    </div>
  );
}

export function PortfolioList({ onAddToPair }: PortfolioListProps) {
  const { address } = useAccount();
  const {
    items,
    hiddenItems,
    totalUsd,
    toggleHidden,
    showAllHidden,
    isLoading,
    isFetching,
    isError,
    refetch,
    scannedCount,
    filteredCount,
    filteredTokens,
  } = usePortfolioTokens();

  const [showFiltered, setShowFiltered] = useState(false);

  type PairInfo = { token1: string; token2: string };
  const { data: savedPairs = [] } = useQuery({
    queryKey: ["pairs", address],
    queryFn: async () => {
      const res = await fetch(
        `/api/pairs?address=${encodeURIComponent(address ?? "")}`
      );
      if (!res.ok) return [];
      return res.json() as Promise<PairInfo[]>;
    },
    enabled: !!address,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  // Enumerate ALL tokens held inside the user's personal vault (raw scan, no
  // scam/liquidity filter) so deposited tokens always show — even ones that
  // aren't in the wallet portfolio or any saved pair (e.g. LIQ).
  const { vaultAddress } = useUserVault();
  const { data: vaultTokenAddrs = [] } = useQuery({
    queryKey: ["vault-scan", vaultAddress],
    queryFn: async () => {
      const res = await fetch(
        `/api/portfolio/scan?address=${vaultAddress}&raw=1`
      );
      if (!res.ok) return [] as string[];
      const data = await res.json();
      return ((data.tokens ?? []) as Array<{ address: string }>).map((t) =>
        t.address.toLowerCase()
      );
    },
    enabled: !!vaultAddress,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const portfolioAddrs = items.map((i) =>
    i.address === "native"
      ? "0x4200000000000000000000000000000000000006"
      : i.address.toLowerCase()
  );
  const pairAddrs = savedPairs.flatMap((p) => [
    p.token1.toLowerCase(),
    p.token2.toLowerCase(),
  ]);
  const allTokenAddrs = [
    ...new Set([...portfolioAddrs, ...pairAddrs, ...vaultTokenAddrs]),
  ];

  const { data: tokenMeta } = useTokenMeta(allTokenAddrs);
  const { getSymbol, getDecimals } = useTokenInfo(allTokenAddrs);

  const { vaultBalances: vaultBalancesRaw } = useVaultBalances(allTokenAddrs);

  const vaultBalances: Record<string, number> = {};
  for (const addr of allTokenAddrs) {
    const raw = vaultBalancesRaw[addr];
    if (raw != null && raw > 0n) {
      vaultBalances[addr] = Number(formatUnits(raw, getDecimals(addr)));
    }
  }

  const portfolioAddrSet = new Set(portfolioAddrs);
  const vaultOnlyAddrs = Object.keys(vaultBalances).filter(
    (addr) => !portfolioAddrSet.has(addr) && vaultBalances[addr] > 0
  );

  const { data: vaultOnlyPrices } = useTokenPrices(vaultOnlyAddrs);

  // Wallet balances for vault-listed tokens — so a token held in BOTH the wallet
  // and the vault (e.g. filtered/hidden from the wallet list) still shows its
  // wallet amount, not just the vault amount.
  const { data: vaultOnlyWalletData } = useReadContracts({
    contracts: vaultOnlyAddrs.map((addr) => ({
      address: addr as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: address ? [address as `0x${string}`] : undefined,
    })),
    query: { enabled: !!address && vaultOnlyAddrs.length > 0 },
  });
  const walletBalOf = (addr: string): number => {
    const i = vaultOnlyAddrs.indexOf(addr);
    if (i < 0) return 0;
    const raw = vaultOnlyWalletData?.[i]?.result as bigint | undefined;
    return raw != null ? Number(formatUnits(raw, getDecimals(addr))) : 0;
  };

  const getPrice = (addr: string): number => {
    const portfolioItem = items.find(
      (it) =>
        it.address.toLowerCase() === addr ||
        (addr === "0x4200000000000000000000000000000000000006" && it.address === "native")
    );
    if (portfolioItem) return portfolioItem.price;
    return vaultOnlyPrices?.[addr] ?? 0;
  };

  const vaultTotalUsd = Object.entries(vaultBalances).reduce((sum, [addr, bal]) => {
    return sum + bal * getPrice(addr);
  }, 0);

  if (!address) return null;

  const getMeta = (item: (typeof items)[0]) => {
    const key =
      item.address === "native"
        ? "0x4200000000000000000000000000000000000006"
        : item.address.toLowerCase();
    return tokenMeta?.[key];
  };

  const getLogo = (item: (typeof items)[0]) => {
    if (FALLBACK_LOGOS[item.address]) return FALLBACK_LOGOS[item.address];
    return getMeta(item)?.logoURI ?? null;
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            My portfolio (Base)
          </h2>
          {isFetching && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              Scanning…
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th className="pb-3 font-medium">Token</th>
                <th className="pb-3 font-medium">Balance</th>
                <th className="pb-3 font-medium">Price USD</th>
                <th className="pb-3 pr-4 font-medium text-right">1h</th>
                <th className="pb-3 pr-6 font-medium text-right">24h</th>
                <th className="pb-3 pl-2 font-medium">Value</th>
                <th className="w-24 pb-3" />
                <th className="w-10 pb-3" aria-label="Hide" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const meta = getMeta(item);
                const logo = getLogo(item);

                return (
                  <tr
                    key={item.address}
                    className="border-b border-border/50 transition-all duration-300 ease-in-out hover:bg-muted/50"
                  >
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <TokenLogo src={logo} symbol={item.symbol} />
                        <div>
                          <a
                            href={
                              item.address === "native"
                                ? `https://basescan.org/address/${item.tokenAddress}`
                                : `https://basescan.org/token/${item.address}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {item.symbol}
                          </a>
                          {item.address !== "native" && (
                            <a
                              href={`https://basescan.org/token/${item.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 block font-mono text-xs text-muted-foreground/70 hover:text-primary/60 hover:underline"
                              title={item.address}
                            >
                              {item.address.slice(0, 6)}…{item.address.slice(-4)}
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="text-foreground">
                        {item.balance.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </div>
                      <VaultBalanceHint address={item.address} vaultBalances={vaultBalances} />
                    </td>
                    <td className="py-3 text-foreground">
                      ${item.price.toFixed(item.price >= 1 ? 2 : 6)}
                    </td>
                    <td className="py-3 pr-4 text-right text-sm">
                      <PriceChangeCell value={meta?.priceChange1h} />
                    </td>
                    <td className="py-3 pr-6 text-right text-sm">
                      <PriceChangeCell value={meta?.priceChange24h} />
                    </td>
                    <td className="py-3 pl-2">
                      <TotalValueCell address={item.address} usdValue={item.usdValue} price={item.price} vaultBalances={vaultBalances} />
                    </td>
                    <td className="py-3">
                      {onAddToPair && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onAddToPair(item.tokenAddress)}
                          className="text-xs text-primary hover:text-primary"
                        >
                          To pair
                        </Button>
                      )}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => toggleHidden(item.address)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Hide token"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {/* Vault-only tokens */}
              {vaultOnlyAddrs.map((addr) => {
                const vBal = vaultBalances[addr] ?? 0;
                const wBal = walletBalOf(addr);
                const meta = tokenMeta?.[addr];
                const symbol = getSymbol(addr);
                const price = getPrice(addr);
                const vUsd = vBal * price;
                const totalUsd = (vBal + wBal) * price;
                const logo = meta?.logoURI ?? null;

                if (totalUsd < 0.01) return null;

                return (
                  <tr
                    key={`vault-${addr}`}
                    className="border-b border-cyan-200 bg-cyan-50 transition-all duration-300 ease-in-out hover:bg-cyan-100/50"
                  >
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <TokenLogo src={logo} symbol={symbol} />
                        <div>
                          <span className="font-medium text-foreground">{symbol}</span>
                          <Badge variant="info" className="ml-1.5 text-[9px] px-1 py-0">
                            vault
                          </Badge>
                          <a
                            href={`https://basescan.org/token/${addr}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 block font-mono text-xs text-muted-foreground/70 hover:text-primary/60 hover:underline"
                          >
                            {addr.slice(0, 6)}…{addr.slice(-4)}
                          </a>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      {wBal > 0 && (
                        <div className="text-foreground">
                          {wBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          <span className="ml-1 text-[10px] text-muted-foreground">wallet</span>
                        </div>
                      )}
                      <div className="text-cyan-700">
                        {vBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        <span className="ml-1 text-[10px] text-cyan-600/70">in vault</span>
                      </div>
                    </td>
                    <td className="py-3 text-foreground">
                      {price > 0 ? `$${price.toFixed(price >= 1 ? 2 : 6)}` : "—"}
                    </td>
                    <td className="py-3 pr-4 text-right text-sm">
                      <PriceChangeCell value={meta?.priceChange1h} />
                    </td>
                    <td className="py-3 pr-6 text-right text-sm">
                      <PriceChangeCell value={meta?.priceChange24h} />
                    </td>
                    <td className="py-3 pl-2">
                      <span className={wBal > 0 ? "text-foreground" : "text-cyan-700"}>
                        {formatUsd(totalUsd)}
                      </span>
                    </td>
                    <td className="py-3" />
                    <td className="py-3" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {items.length === 0 && (
          <div className="py-10 text-center">
            {isLoading ? (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                Scanning your wallet on Base…
              </p>
            ) : isError ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Couldn&apos;t load your portfolio.
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : scannedCount === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tokens found in this wallet on Base.
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Nothing to display
                </p>
                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                  {scannedCount} token{scannedCount === 1 ? "" : "s"} in this
                  wallet were hidden automatically — low liquidity, suspected
                  spam, or dust under $0.50. A token needs a DEX pool with ≥
                  $5,000 liquidity to be shown and paired.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4">
          {/* Left: filter info + manual-hidden toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {filteredCount > 0 && (
              <button
                type="button"
                onClick={() => setShowFiltered((v) => !v)}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {filteredCount} low-liquidity / spam token
                {filteredCount === 1 ? "" : "s"} hidden — {showFiltered ? "hide list ▲" : "view list ▼"}
              </button>
            )}
            {hiddenItems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={showAllHidden}
                className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              >
                Restore {hiddenItems.length} manually hidden
              </Button>
            )}
          </div>
          {/* Right: total */}
          <span className="ml-auto">
            <span className="text-muted-foreground">Total: </span>
            <span className="text-lg font-semibold text-foreground">
              {formatUsd(totalUsd + vaultTotalUsd)}
            </span>
            {vaultTotalUsd > 0.01 && (
              <span className="ml-2 text-xs text-cyan-600">
                (vault: {formatUsd(vaultTotalUsd)})
              </span>
            )}
          </span>
        </div>

        {showFiltered && filteredTokens.length > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-muted/30">
            <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              Auto-hidden tokens ({filteredTokens.length} shown). Hidden because
              they have no real DEX liquidity, look like spam, or are flagged as
              scams. Always verify a contract before trusting it.
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
              {filteredTokens.map((t) => (
                <div
                  key={t.address}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                >
                  <a
                    href={`https://basescan.org/token/${t.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline"
                    title={t.address}
                  >
                    {t.symbol || "???"}{" "}
                    <span className="font-mono text-muted-foreground">
                      {t.address.slice(0, 6)}…{t.address.slice(-4)}
                    </span>
                  </a>
                  <span className="w-28 truncate text-right text-muted-foreground">
                    {t.balanceFormatted.toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })}
                  </span>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px] font-normal"
                  >
                    {t.reason === "low_liquidity"
                      ? "low liq"
                      : t.reason === "scam"
                        ? "scam"
                        : "spam"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
