"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { base } from "viem/chains";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { TOKENS } from "@/lib/constants";
import { useTokenPrices } from "./use-token-prices";

const HIDDEN_KEY = "rebalancer-hidden-tokens";
const SCAN_CACHE_KEY = "rebalancer-scan-cache";
const SCAN_CACHE_TTL = 24 * 60 * 60 * 1000; // keep last scan for a day

export type FilteredToken = {
  address: string;
  symbol: string;
  balanceFormatted: number;
  decimals: number;
  reason: "spam" | "scam" | "low_liquidity";
  liquidityUsd?: number;
  priceUsd?: number;
};

type ScanResult = {
  tokens: Array<{
    address: string;
    balanceFormatted: number;
    decimals: number;
    symbol: string;
  }>;
  scannedCount: number;
  filteredCount: number;
  hidden: FilteredToken[];
  error: string | null;
};

function readScanCache(addr: string | undefined): ScanResult | undefined {
  if (!addr) return undefined;
  try {
    const raw = localStorage.getItem(SCAN_CACHE_KEY);
    if (!raw) return undefined;
    const all = JSON.parse(raw) as Record<string, { ts: number; data: ScanResult }>;
    const entry = all[addr.toLowerCase()];
    if (!entry || Date.now() - entry.ts > SCAN_CACHE_TTL) return undefined;
    return entry.data;
  } catch {
    return undefined;
  }
}

function writeScanCache(addr: string, data: ScanResult) {
  try {
    const raw = localStorage.getItem(SCAN_CACHE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, { ts: number; data: ScanResult }>) : {};
    all[addr.toLowerCase()] = { ts: Date.now(), data };
    localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(all));
  } catch {
    // ignore quota / serialization errors
  }
}

export type PortfolioItem = {
  address: string; // "native" for ETH, else contract address
  tokenAddress: string; // contract address for selection (WETH for native ETH)
  symbol: string;
  balance: number;
  price: number;
  usdValue: number;
  decimals: number;
};

export function usePortfolioTokens() {
  const { address } = useAccount();
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    try {
      const s = localStorage.getItem(HIDDEN_KEY);
      if (s) {
        const arr = JSON.parse(s) as string[];
        setHiddenSet(new Set(arr.map((a) => a.toLowerCase())));
      }
    } catch {
      // ignore
    }
  }, []);

  const saveHidden = useCallback((next: Set<string>) => {
    setHiddenSet(next);
    try {
      localStorage.setItem(
        HIDDEN_KEY,
        JSON.stringify(Array.from(next))
      );
    } catch {
      // ignore
    }
  }, []);

  const toggleHidden = useCallback(
    (addr: string) => {
      const key = addr.toLowerCase();
      const next = new Set(hiddenSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveHidden(next);
    },
    [hiddenSet, saveHidden]
  );

  const { data: ethBalance } = useBalance({
    address,
    chainId: base.id,
  });

  const {
    data: scanData,
    isLoading: scanLoading,
    isFetching: scanFetching,
    isError: scanIsError,
    refetch: refetchScan,
  } = useQuery({
    queryKey: ["portfolio-scan", address],
    queryFn: async (): Promise<ScanResult> => {
      const res = await fetch(
        `/api/portfolio/scan?address=${encodeURIComponent(address ?? "")}`
      );
      const data = await res.json();
      const result: ScanResult = {
        tokens: data.tokens ?? [],
        scannedCount: (data.scannedCount ?? 0) as number,
        filteredCount: (data.filteredCount ?? 0) as number,
        hidden: (data.hidden ?? []) as FilteredToken[],
        error: (data.error ?? null) as string | null,
      };
      if (address && !result.error) writeScanCache(address, result);
      return result;
    },
    enabled: !!address,
    staleTime: 60_000,
    // Seed from the last persisted scan so a page refresh shows the previous
    // result instantly instead of an empty table, while it refetches.
    initialData: () => readScanCache(address),
    initialDataUpdatedAt: 0,
    placeholderData: keepPreviousData,
  });

  const scannedTokens = scanData?.tokens ?? [];
  const scannedCount = scanData?.scannedCount ?? 0;
  const filteredCount = scanData?.filteredCount ?? 0;
  const filteredTokens = scanData?.hidden ?? [];
  const scanError = scanIsError || Boolean(scanData?.error);

  const useScan = scannedTokens.length > 0;

  const tokenAddresses = useMemo(() => {
    if (!useScan) return [] as string[];

    const knownSet = new Set(
      Object.values(TOKENS).map((a) => a.toLowerCase())
    );
    // High-value tokens with small numeric balances (e.g. cbBTC 0.0002 = $15)
    const highValue = new Set([
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
      ...knownSet,
    ]);

    const known: string[] = [];
    const rest: typeof scannedTokens = [];

    for (const t of scannedTokens) {
      if (t.balanceFormatted <= 0) continue;
      const addr = t.address.toLowerCase();
      if (highValue.has(addr)) {
        known.push(addr);
      } else if (t.balanceFormatted >= 0.01) {
        rest.push(t);
      }
    }

    // Sort rest by balance desc, take top N to stay under URL limits
    rest.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
    const limit = 60 - known.length;
    const addrs = [...known, ...rest.slice(0, limit).map((t) => t.address.toLowerCase())];

    if (ethBalance?.value && Number(formatUnits(ethBalance.value, 18)) > 0) {
      if (!addrs.includes(TOKENS.WETH.toLowerCase())) {
        addrs.push(TOKENS.WETH.toLowerCase());
      }
    }
    return addrs;
  }, [useScan, scannedTokens, ethBalance?.value]);

  // Stage 1: fast prices (DexScreener + CoinGecko)
  const { data: prices } = useTokenPrices(tokenAddresses);

  // Stage 2: find tokens with balance > 0.1 but no price → try GeckoTerminal pools
  const unpricedWithBalance = useMemo(
    () =>
      useScan
        ? scannedTokens
            .filter((t) => {
              const addr = t.address.toLowerCase();
              return t.balanceFormatted > 0.1 && (prices?.[addr] ?? 0) === 0;
            })
            .map((t) => t.address.toLowerCase())
        : [],
    [useScan, scannedTokens, prices]
  );
  const { data: poolPrices } = useTokenPrices(unpricedWithBalance, {
    poolFallback: true,
  });

  // Merge prices: pool prices override fast prices for tokens that got a pool price
  const allPrices: Record<string, number> = { ...prices };
  if (poolPrices) {
    for (const [addr, price] of Object.entries(poolPrices)) {
      if (price > 0) allPrices[addr] = price;
    }
  }

  const ethPrice = allPrices?.[TOKENS.WETH.toLowerCase()] ?? 0;
  const ethBal = ethBalance?.value ? Number(formatUnits(ethBalance.value, 18)) : 0;
  const ethUsd = ethBal * ethPrice;

  const filtered = useMemo(() => {
    const items: PortfolioItem[] = [];
    if (ethBal > 0) {
      items.push({
        address: "native",
        tokenAddress: TOKENS.WETH,
        symbol: "ETH",
        balance: ethBal,
        price: ethPrice,
        usdValue: ethUsd,
        decimals: 18,
      });
    }

    if (useScan) {
      for (const t of scannedTokens) {
        if (t.balanceFormatted <= 0) continue;
        const addr = t.address.toLowerCase();
        const price = allPrices?.[addr] ?? 0;
        const usdValue = t.balanceFormatted * price;
        items.push({
          address: t.address,
          tokenAddress: t.address,
          symbol: t.symbol,
          balance: t.balanceFormatted,
          price,
          usdValue,
          decimals: t.decimals,
        });
      }
    }

    return items
      .filter((i) => i.balance > 0 && i.usdValue >= 0.5)
      .sort((a, b) => {
        const diff = b.usdValue - a.usdValue;
        // Stable secondary key: prevent jumping when usdValues are close
        if (Math.abs(diff) < 0.01) return a.address.localeCompare(b.address);
        return diff;
      });
  }, [ethBal, ethPrice, ethUsd, useScan, scannedTokens, allPrices]);

  const visibleItems = useMemo(
    () => filtered.filter((i) => !hiddenSet.has(i.address.toLowerCase())),
    [filtered, hiddenSet]
  );
  const hiddenItems = useMemo(
    () => filtered.filter((i) => hiddenSet.has(i.address.toLowerCase())),
    [filtered, hiddenSet]
  );

  const showAllHidden = useCallback(() => {
    saveHidden(new Set());
  }, [saveHidden]);

  return {
    items: visibleItems,
    hiddenItems,
    hiddenSet,
    toggleHidden,
    showAllHidden,
    // Transparency: scan lifecycle + how many tokens the auto-filter hid.
    isLoading: scanLoading,
    isFetching: scanFetching,
    isError: scanError,
    refetch: refetchScan,
    scannedCount,
    filteredCount,
    filteredTokens,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    totalUsd: useMemo(() => visibleItems.reduce((s, i) => s + i.usdValue, 0), [visibleItems]),
  };
}
