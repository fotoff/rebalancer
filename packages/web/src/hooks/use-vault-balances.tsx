"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import { keepPreviousData } from "@tanstack/react-query";
import { useUserVault } from "./use-user-vault";

// ── Types ──────────────────────────────────────────────────
type VaultBalancesContextValue = {
  /** Raw bigint vault balances by lowercase token address */
  balances: Record<string, bigint>;
  /** Register token addresses that need vault balance reads */
  registerTokens: (addrs: string[]) => void;
  /** Force refetch all vault balances */
  refetch: () => void;
};

const VaultBalancesContext = createContext<VaultBalancesContextValue>({
  balances: {},
  registerTokens: () => {},
  refetch: () => {},
});

// ── Provider ───────────────────────────────────────────────
export function VaultBalancesProvider({ children }: { children: ReactNode }) {
  // The single source of truth is now the user's personal non-custodial vault.
  // Its balance of a token is simply erc20.balanceOf(vaultAddress).
  const { vaultAddress } = useUserVault();
  const [tokenSet, setTokenSet] = useState<Set<string>>(new Set());

  const hasVault = Boolean(vaultAddress);

  // Components call this to register which tokens they need
  const registerTokens = useCallback((addrs: string[]) => {
    setTokenSet((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const a of addrs) {
        const key = a.toLowerCase();
        if (key && !next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Sorted for deterministic query key
  const sortedTokens = useMemo(
    () => [...tokenSet].sort(),
    [tokenSet]
  );

  // Single useReadContracts for ALL vault balances: balanceOf(vault) per token.
  const { data, refetch } = useReadContracts({
    contracts: sortedTokens.map((addr) => ({
      address: addr as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: vaultAddress ? [vaultAddress] : undefined,
    })),
    query: {
      enabled: hasVault && sortedTokens.length > 0,
      placeholderData: keepPreviousData,
      refetchInterval: 30_000,
    },
  });

  // Build balances map
  const balances = useMemo(() => {
    const map: Record<string, bigint> = {};
    if (data) {
      sortedTokens.forEach((addr, i) => {
        const raw = data[i]?.result as bigint | undefined;
        if (raw != null) {
          map[addr] = raw;
        }
      });
    }
    return map;
  }, [data, sortedTokens]);

  const stableRefetch = useCallback(() => {
    refetch();
  }, [refetch]);

  const value = useMemo(
    () => ({ balances, registerTokens, refetch: stableRefetch }),
    [balances, registerTokens, stableRefetch]
  );

  return (
    <VaultBalancesContext.Provider value={value}>
      {children}
    </VaultBalancesContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────

/**
 * Register token addresses and get their vault balances (raw bigint).
 * All components share a single on-chain read through VaultBalancesProvider.
 */
export function useVaultBalances(tokenAddresses: string[]) {
  const ctx = useContext(VaultBalancesContext);

  // Register addresses on mount / change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableKey = tokenAddresses
    .map((a) => a.toLowerCase())
    .sort()
    .join(",");

  useEffect(() => {
    if (stableKey) {
      ctx.registerTokens(stableKey.split(","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey]);

  return {
    /** Raw bigint balances keyed by lowercase address */
    vaultBalances: ctx.balances,
    /** Force refetch */
    refetchVault: ctx.refetch,
  };
}
