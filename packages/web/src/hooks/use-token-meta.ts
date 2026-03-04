"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

export type TokenMeta = {
  priceChange1h: number | null;
  priceChange24h: number | null;
  logoURI: string | null;
};

export function useTokenMeta(addresses: string[]) {
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
    queryKey: ["token-meta", addrKey],
    queryFn: async () => {
      if (!addrKey) return {} as Record<string, TokenMeta>;
      const params = new URLSearchParams({ addresses: addrKey });
      const res = await fetch(`/api/token-meta?${params.toString()}`);
      if (!res.ok) return {} as Record<string, TokenMeta>;
      return (await res.json()) as Record<string, TokenMeta>;
    },
    enabled: addrKey.length > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
