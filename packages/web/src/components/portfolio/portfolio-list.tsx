"use client";

import Image from "next/image";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { usePortfolioTokens } from "@/hooks/use-portfolio-tokens";
import { useTokenMeta } from "@/hooks/use-token-meta";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { useVaultBalances } from "@/hooks/use-vault-balances";
import { useTokenInfo } from "@/hooks/use-token-info";

type PortfolioListProps = {
  onAddToPair?: (tokenAddress: string) => void;
};

// Fallback logos for native ETH and common stablecoins
const FALLBACK_LOGOS: Record<string, string> = {
  native: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
};

function PriceChangeCell({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <span className="text-white/30">—</span>;
  }
  const isPositive = value > 0;
  const isZero = value === 0;
  const color = isZero
    ? "text-white/50"
    : isPositive
      ? "text-emerald-400"
      : "text-red-400";
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
    // Fallback: colored circle with first letter
    const charCode = symbol.charCodeAt(0) || 65;
    const hue = (charCode * 47) % 360;
    return (
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ backgroundColor: `hsl(${hue}, 50%, 35%)` }}
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
    <div className="text-[10px] text-cyan-400/70">
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
      <span className="text-white/90">
        ${totalUsdItem.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </span>
      {vUsd > 0.01 && (
        <div className="text-[10px] text-cyan-400/70">
          vault: ${vUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

export function PortfolioList({ onAddToPair }: PortfolioListProps) {
  const { address } = useAccount();
  const { items, hiddenItems, totalUsd, toggleHidden, showAllHidden } =
    usePortfolioTokens();

  // Fetch saved pairs to find vault-only tokens
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

  // Collect all token addresses: from portfolio + from pairs
  const portfolioAddrs = items.map((i) =>
    i.address === "native"
      ? "0x4200000000000000000000000000000000000006"
      : i.address.toLowerCase()
  );
  const pairAddrs = savedPairs.flatMap((p) => [
    p.token1.toLowerCase(),
    p.token2.toLowerCase(),
  ]);
  const allTokenAddrs = [...new Set([...portfolioAddrs, ...pairAddrs])];

  const { data: tokenMeta } = useTokenMeta(allTokenAddrs);
  const { getSymbol, getDecimals } = useTokenInfo(allTokenAddrs);

  // Shared vault balances (single source of truth via VaultBalancesProvider)
  const { vaultBalances: vaultBalancesRaw } = useVaultBalances(allTokenAddrs);

  // Build formatted vault balances map
  const vaultBalances: Record<string, number> = {};
  for (const addr of allTokenAddrs) {
    const raw = vaultBalancesRaw[addr];
    if (raw != null && raw > 0n) {
      vaultBalances[addr] = Number(formatUnits(raw, getDecimals(addr)));
    }
  }

  // Vault-only tokens (in vault but not in wallet portfolio)
  const portfolioAddrSet = new Set(portfolioAddrs);
  const vaultOnlyAddrs = Object.keys(vaultBalances).filter(
    (addr) => !portfolioAddrSet.has(addr) && vaultBalances[addr] > 0
  );

  // Get prices for vault-only tokens
  const { data: vaultOnlyPrices } = useTokenPrices(vaultOnlyAddrs);

  // Helper: get price for any address
  const getPrice = (addr: string): number => {
    // Check portfolio items first
    const portfolioItem = items.find(
      (it) =>
        it.address.toLowerCase() === addr ||
        (addr === "0x4200000000000000000000000000000000000006" && it.address === "native")
    );
    if (portfolioItem) return portfolioItem.price;
    // Then vault-only prices
    return vaultOnlyPrices?.[addr] ?? 0;
  };

  // Total vault USD
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
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-4 text-lg font-semibold text-white">
        My portfolio (Base)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10 text-sm text-white/60">
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
                  className="border-b border-white/5 hover:bg-white/5 transition-all duration-300 ease-in-out"
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
                          className="font-medium text-white hover:text-[#0052FF] hover:underline"
                        >
                          {item.symbol}
                        </a>
                        {item.address !== "native" && (
                          <a
                            href={`https://basescan.org/token/${item.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 block font-mono text-xs text-white/30 hover:text-[#0052FF]/60 hover:underline"
                            title={item.address}
                          >
                            {item.address.slice(0, 6)}…{item.address.slice(-4)}
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    <div className="text-white/90">
                      {item.balance.toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}
                    </div>
                    <VaultBalanceHint address={item.address} vaultBalances={vaultBalances} />
                  </td>
                  <td className="py-3 text-white/90">
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
                      <button
                        type="button"
                        onClick={() => onAddToPair(item.tokenAddress)}
                        className="rounded bg-[#0052FF]/20 px-2 py-1 text-xs font-medium text-[#0052FF] hover:bg-[#0052FF]/30"
                      >
                        To pair
                      </button>
                    )}
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => toggleHidden(item.address)}
                      className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/70"
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
            {/* Vault-only tokens (not in wallet) */}
            {vaultOnlyAddrs.map((addr) => {
              const vBal = vaultBalances[addr] ?? 0;
              const meta = tokenMeta?.[addr];
              const symbol = getSymbol(addr);
              const price = getPrice(addr);
              const vUsd = vBal * price;
              const logo = meta?.logoURI ?? null;

              if (vUsd < 0.01) return null;

              return (
                <tr
                  key={`vault-${addr}`}
                  className="border-b border-cyan-500/10 bg-cyan-500/5 hover:bg-cyan-500/10 transition-all duration-300 ease-in-out"
                >
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <TokenLogo src={logo} symbol={symbol} />
                      <div>
                        <span className="font-medium text-white">{symbol}</span>
                        <span className="ml-1.5 rounded bg-cyan-500/20 px-1 py-0.5 text-[9px] font-medium text-cyan-400">
                          vault
                        </span>
                        <a
                          href={`https://basescan.org/token/${addr}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 block font-mono text-xs text-white/30 hover:text-[#0052FF]/60 hover:underline"
                        >
                          {addr.slice(0, 6)}…{addr.slice(-4)}
                        </a>
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    <div className="text-cyan-400/90">
                      {vBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </div>
                    <div className="text-[10px] text-cyan-400/50">in vault</div>
                  </td>
                  <td className="py-3 text-white/90">
                    {price > 0 ? `$${price.toFixed(price >= 1 ? 2 : 6)}` : "—"}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm">
                    <PriceChangeCell value={meta?.priceChange1h} />
                  </td>
                  <td className="py-3 pr-6 text-right text-sm">
                    <PriceChangeCell value={meta?.priceChange24h} />
                  </td>
                  <td className="py-3 pl-2 text-cyan-400/90">
                    ${vUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3" />
                  <td className="py-3" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
        {hiddenItems.length > 0 ? (
          <button
            type="button"
            onClick={showAllHidden}
            className="text-sm text-white/50 hover:text-white/80"
          >
            Show {hiddenItems.length} hidden
          </button>
        ) : (
          <span />
        )}
        <span>
          <span className="text-white/60">Total: </span>
          <span className="text-lg font-semibold text-white">
            $
            {(totalUsd + vaultTotalUsd).toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}
          </span>
          {vaultTotalUsd > 0.01 && (
            <span className="ml-2 text-xs text-cyan-400/70">
              (vault: ${vaultTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })})
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
