"use client";

import { useMemo, useCallback } from "react";
import { useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import { KNOWN_TOKENS } from "@/lib/tokens";

/**
 * Hook that resolves symbol & decimals for a list of token addresses.
 * Uses KNOWN_TOKENS as cache, falls back to on-chain ERC-20 reads.
 *
 * Returns:
 *   getSymbol(addr) → string
 *   getDecimals(addr) → number
 *   tokenInfo → Record<string, { symbol: string; decimals: number }>
 */
export function useTokenInfo(addresses: string[]) {
  // Stable key from addresses — prevents useMemo invalidation on every render
  const addrKey = addresses
    .map((a) => a.toLowerCase())
    .sort()
    .join(",");

  // Deduplicate and lowercase
  const uniqueAddrs = useMemo(() => {
    const set = new Set(addrKey ? addrKey.split(",") : []);
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrKey]);

  // Find addresses not in KNOWN_TOKENS — need on-chain read
  const unknownAddrs = useMemo(
    () => uniqueAddrs.filter((a) => !KNOWN_TOKENS[a]),
    [uniqueAddrs]
  );

  // Batch read symbol() and decimals() for unknown tokens
  const { data: onChainResults } = useReadContracts({
    contracts: [
      ...unknownAddrs.map((addr) => ({
        address: addr as `0x${string}`,
        abi: erc20Abi,
        functionName: "symbol" as const,
      })),
      ...unknownAddrs.map((addr) => ({
        address: addr as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals" as const,
      })),
    ],
    query: { enabled: unknownAddrs.length > 0 },
  });

  // Parse on-chain results into lookup maps
  const { onChainSymbols, onChainDecimals } = useMemo(() => {
    const syms: Record<string, string> = {};
    const decs: Record<string, number> = {};
    if (onChainResults) {
      const half = unknownAddrs.length;
      unknownAddrs.forEach((addr, i) => {
        const sym = onChainResults[i]?.result as string | undefined;
        if (sym) syms[addr] = sym;
        const dec = onChainResults[half + i]?.result as number | undefined;
        if (dec != null) decs[addr] = dec;
      });
    }
    return { onChainSymbols: syms, onChainDecimals: decs };
  }, [onChainResults, unknownAddrs]);

  // Stable getters via useCallback
  const getSymbol = useCallback(
    (addr: string): string => {
      const key = addr.toLowerCase();
      return (
        KNOWN_TOKENS[key]?.symbol ??
        onChainSymbols[key] ??
        `${key.slice(0, 6)}…`
      );
    },
    [onChainSymbols]
  );

  const getDecimals = useCallback(
    (addr: string): number => {
      const key = addr.toLowerCase();
      return (
        KNOWN_TOKENS[key]?.decimals ??
        onChainDecimals[key] ??
        18
      );
    },
    [onChainDecimals]
  );

  // Full info map
  const tokenInfo = useMemo(() => {
    const map: Record<string, { symbol: string; decimals: number }> = {};
    for (const addr of uniqueAddrs) {
      map[addr] = {
        symbol: getSymbol(addr),
        decimals: getDecimals(addr),
      };
    }
    return map;
  }, [uniqueAddrs, getSymbol, getDecimals]);

  return { getSymbol, getDecimals, tokenInfo };
}
