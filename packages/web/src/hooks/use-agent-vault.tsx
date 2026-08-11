"use client";

import { useAccount, useReadContract } from "wagmi";
import { AGENT_FACTORY_ADDRESS, ZERO_ADDRESS } from "@/lib/constants";
import { AGENT_FACTORY_ABI } from "@/lib/agent-abi";

/**
 * Resolves the connected user's AgentVault via the AgentVaultFactory.
 * Deliberately separate from useUserVault: the agent layer is its own set of
 * contracts running alongside the operator-driven UserVault.
 */
export function useAgentVault() {
  const { address } = useAccount();

  const factoryConfigured = AGENT_FACTORY_ADDRESS !== ZERO_ADDRESS;

  const { data, isLoading, refetch } = useReadContract({
    address: AGENT_FACTORY_ADDRESS,
    abi: AGENT_FACTORY_ABI,
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
