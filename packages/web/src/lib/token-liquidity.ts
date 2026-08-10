/**
 * DexScreener-based liquidity lookup. The single most reliable signal for
 * filtering airdrop/spam tokens: a real token trades in a pool with real
 * liquidity; scam tokens have no pool or a microscopic one with a fabricated
 * price. We pick the BEST (max-liquidity) pair per token so a $10 honeypot
 * pool can't set the displayed price.
 */

const DEXSCREENER_BASE = "https://api.dexscreener.com";

export type TokenLiquidity = {
  priceUsd: number;
  liquidityUsd: number;
};

type DexPair = {
  baseToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
};

/**
 * Returns a map addr -> { priceUsd, liquidityUsd } using the highest-liquidity
 * pair for each token. Addresses with no pair are simply absent from the map.
 * `ok` is false if every DexScreener request failed (so callers can avoid
 * hiding everything during an outage).
 */
export async function fetchTokenLiquidity(
  addresses: string[]
): Promise<{ map: Map<string, TokenLiquidity>; ok: boolean }> {
  const map = new Map<string, TokenLiquidity>();
  const lower = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const CHUNK = 30;
  let anySuccess = false;

  for (let i = 0; i < lower.length; i += CHUNK) {
    const chunk = lower.slice(i, i + CHUNK);
    try {
      const res = await fetch(`${DEXSCREENER_BASE}/tokens/v1/base/${chunk.join(",")}`, {
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;
      anySuccess = true;
      const pairs = (await res.json()) as DexPair[];
      for (const p of pairs) {
        const addr = p.baseToken?.address?.toLowerCase();
        if (!addr) continue;
        const priceUsd = p.priceUsd ? parseFloat(p.priceUsd) : 0;
        const liquidityUsd = p.liquidity?.usd ?? 0;
        const prev = map.get(addr);
        // keep the pair with the highest liquidity
        if (!prev || liquidityUsd > prev.liquidityUsd) {
          map.set(addr, { priceUsd, liquidityUsd });
        }
      }
    } catch {
      // network error on this chunk — skip
    }
  }

  return { map, ok: anySuccess };
}
