import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { base } from "viem/chains";
import {
  FACTORY_ADDRESS,
  AGENT_FACTORY_ADDRESS,
  ZERO_ADDRESS,
} from "@/lib/constants";
import { fetchTokenLiquidity } from "@/lib/token-liquidity";
import { vaultHistory } from "@/lib/db";
import { log } from "@/lib/logger";

/**
 * GET /api/stats — public protocol metrics.
 *
 * `vaults` and `tvlUsd` are read live from Base and can be reproduced by anyone
 * from the factory address. `rebalances` comes from our own execution log:
 * counting Rebalanced events all-time would need a paid archive/indexer (public
 * Base RPC caps eth_getLogs at 10k blocks, Alchemy's free tier at 10), so the
 * response labels each metric's source explicitly rather than implying all of
 * it is chain-derived.
 */

const AGENT_FACTORY_ABI = parseAbi([
  "function vaultsCount() view returns (uint256)",
  "function allVaults(uint256) view returns (address)",
]);

const FACTORY_ABI = parseAbi([
  "function vaultsCount() view returns (uint256)",
  "function allVaults(uint256) view returns (address)",
]);
const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)"]);

export const revalidate = 60;

/** Non-zero ERC-20 holdings of an address, via Alchemy. */
async function scanHoldings(
  apiKey: string,
  owner: string
): Promise<Array<{ token: string; raw: bigint }>> {
  const res = await fetch(`https://base-mainnet.g.alchemy.com/v2/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenBalances",
      params: [owner, "erc20"],
    }),
    next: { revalidate: 60 },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    result?: { tokenBalances?: Array<{ contractAddress: string; tokenBalance: string; error?: string }> };
  };
  return (json.result?.tokenBalances ?? [])
    .filter((t) => !t.error && t.tokenBalance && BigInt(t.tokenBalance) > 0n)
    .map((t) => ({ token: t.contractAddress.toLowerCase(), raw: BigInt(t.tokenBalance) }));
}

export async function GET() {
  if (FACTORY_ADDRESS === ZERO_ADDRESS) {
    return NextResponse.json({ error: "Factory not configured" }, { status: 200 });
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });

  try {
    // ── On-chain: vault registry ──────────────────────────
    const count = await client.readContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "vaultsCount",
    });
    const n = Number(count);

    const vaults = n
      ? ((await client.multicall({
          contracts: Array.from({ length: n }, (_, i) => ({
            address: FACTORY_ADDRESS,
            abi: FACTORY_ABI,
            functionName: "allVaults" as const,
            args: [BigInt(i)] as const,
          })),
        })) as Array<{ result?: `0x${string}` }>)
          .map((r) => r.result)
          .filter((a): a is `0x${string}` => Boolean(a))
      : [];

    // ── On-chain: the parallel agent-vault registry ────────
    // Counting agent *trades* would need log indexing, which the free RPC tier
    // cannot serve, so only the vault count is reported here rather than a
    // number we cannot stand behind.
    let agentVaults: number | null = null;
    let agentVaultAddrs: `0x${string}`[] = [];
    if (AGENT_FACTORY_ADDRESS !== ZERO_ADDRESS) {
      try {
        const an = Number(
          await client.readContract({
            address: AGENT_FACTORY_ADDRESS,
            abi: AGENT_FACTORY_ABI,
            functionName: "vaultsCount",
          })
        );
        agentVaults = an;
        agentVaultAddrs = an
          ? ((await client.multicall({
              contracts: Array.from({ length: an }, (_, i) => ({
                address: AGENT_FACTORY_ADDRESS,
                abi: AGENT_FACTORY_ABI,
                functionName: "allVaults" as const,
                args: [BigInt(i)] as const,
              })),
            })) as Array<{ result?: `0x${string}` }>)
              .map((r) => r.result)
              .filter((a): a is `0x${string}` => Boolean(a))
          : [];
      } catch (e) {
        log.warn("stats", "Agent vault read failed", { error: String(e) });
      }
    }

    // ── On-chain: TVL across every vault's actual holdings ──
    // Both registries count: an agent vault custodies user funds exactly like a
    // UserVault does, so leaving it out understates TVL.
    let tvlUsd = 0;
    const tvlByToken: Record<string, number> = {};
    const apiKey = process.env.ALCHEMY_API_KEY;
    const allVaultAddrs = [...vaults, ...agentVaultAddrs];

    if (apiKey && allVaultAddrs.length) {
      const perVault = await Promise.all(
        allVaultAddrs.map((v) => scanHoldings(apiKey, v))
      );
      const holdings = perVault.flat();

      if (holdings.length) {
        const addrs = [...new Set(holdings.map((h) => h.token))];

        const [decimalsRes, { map: liq }] = await Promise.all([
          client.multicall({
            contracts: addrs.map((a) => ({
              address: a as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "decimals" as const,
            })),
          }) as Promise<Array<{ result?: number }>>,
          fetchTokenLiquidity(addrs),
        ]);

        const decOf = new Map<string, number>();
        addrs.forEach((a, i) => decOf.set(a, decimalsRes[i]?.result ?? 18));

        for (const h of holdings) {
          const price = liq.get(h.token)?.priceUsd ?? 0;
          if (price <= 0) continue; // unpriced dust/spam doesn't inflate TVL
          const amount = Number(formatUnits(h.raw, decOf.get(h.token) ?? 18));
          const usd = amount * price;
          if (usd < 0.01) continue;
          tvlUsd += usd;
          tvlByToken[h.token] = (tvlByToken[h.token] ?? 0) + usd;
        }
      }
    }

    // ── Execution log: rebalances / deposits ──────────────
    let rebalances = 0;
    let deposits = 0;
    let activeUsers = 0;
    try {
      const counts = vaultHistory.countByType();
      rebalances = counts.rebalance ?? 0;
      deposits = counts.deposit ?? 0;
      activeUsers = vaultHistory.countUsers();
    } catch (e) {
      log.warn("stats", "history read failed", { error: String(e) });
    }

    return NextResponse.json({
      network: "base",
      chainId: 8453,
      factory: FACTORY_ADDRESS,
      vaults: n,
      vaultsTotal: n + (agentVaults ?? 0),
      agentFactory: AGENT_FACTORY_ADDRESS,
      agentVaults,
      tvlUsd: Math.round(tvlUsd * 100) / 100,
      tvlByToken,
      rebalances,
      deposits,
      activeUsers,
      sources: {
        vaults: "onchain",
        agentVaults: "onchain",
        tvlUsd: "onchain",
        rebalances: "execution-log",
        deposits: "execution-log",
        activeUsers: "execution-log",
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error("stats", "Stats read failed", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to read stats", detail: String(err) },
      { status: 200 }
    );
  }
}
