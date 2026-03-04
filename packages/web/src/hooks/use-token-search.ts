"use client";

import { useQuery } from "@tanstack/react-query";

export function useTokenSearch(query: string) {
  return useQuery({
    queryKey: ["token-search", query],
    queryFn: async () => {
      if (!query || query.length < 2) return [];
      const res = await fetch(`/api/tokens/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      return res.json() as Promise<{ address: string; symbol: string }[]>;
    },
    enabled: query.length >= 2,
    staleTime: 60_000,
  });
}
