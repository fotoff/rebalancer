"use client";

import { useAccount, useReadContract } from "wagmi";
import { FACTORY_ADDRESS, ZERO_ADDRESS } from "@/lib/constants";
import { FACTORY_ABI } from "@/lib/noncustodial-abi";

/**
 * Resolves the connected user's personal UserVault via the factory.
 * Returns the vault address (or null if not deployed yet) plus loading/refetch.
 */
export function useUserVault() {
  const { address } = useAccount();

  const factoryConfigured = FACTORY_ADDRESS !== ZERO_ADDRESS;

  const { data, isLoading, refetch } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "vaultOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && factoryConfigured },
  });

  const vaultAddress =
    data && data !== ZERO_ADDRESS ? (data as `0x${string}`) : null;

  return {
    factoryConfigured,
    vaultAddress,
    hasVault: Boolean(vaultAddress),
    isLoading,
    refetch,
  };
}
