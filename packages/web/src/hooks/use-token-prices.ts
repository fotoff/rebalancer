"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

export function useTokenPrices(
  addresses: string[],
  options?: { poolFallback?: boolean }
) {
  const poolFallback = options?.poolFallback ?? false;

  // Stable key — prevents query invalidation from new array references
  const addrKey = useMemo(
    () =>
      [...new Set(addresses.map((a) => a.toLowerCase()))]
        .sort()
        .join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addresses.map((a) => a.toLowerCase()).sort().join(",")]
  );

  return useQuery({
    queryKey: [
      "token-prices",
      addrKey,
      poolFallback ? "pool" : "fast",
    ],
    queryFn: async () => {
      if (!addrKey) return {};
      const allAddrs = addrKey.split(",");
      const CHUNK = 25;
      const merged: Record<string, number> = {};
      for (let i = 0; i < allAddrs.length; i += CHUNK) {
        const chunk = allAddrs.slice(i, i + CHUNK).join(",");
        const params = new URLSearchParams({ addresses: chunk });
        if (poolFallback) params.set("pool_fallback", "true");
        const res = await fetch(`/api/prices?${params}`);
        if (!res.ok) continue;
        const data = (await res.json()) as Record<string, number>;
        Object.assign(merged, data);
      }
      return merged;
    },
    enabled: addrKey.length > 0,
    staleTime: poolFallback ? 120_000 : 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
