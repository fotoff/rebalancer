import { NextRequest, NextResponse } from "next/server";

/**
 * Returns token metadata from DexScreener:
 * - priceChange1h / priceChange24h (%)
 * - logoURI
 *
 * GET /api/token-meta?addresses=0x...,0x...
 */

const DEXSCREENER_BASE = "https://api.dexscreener.com";

// Well-known logos for stablecoins/ETH that DexScreener may not cover
const KNOWN_LOGOS: Record<string, string> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913":
    "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  "0x4200000000000000000000000000000000000006":
    "https://assets.coingecko.com/coins/images/2518/small/weth.png",
};

export type TokenMeta = {
  priceChange1h: number | null;
  priceChange24h: number | null;
  logoURI: string | null;
};

type DexPair = {
  baseToken?: { address?: string };
  priceChange?: { h1?: number; h24?: number };
  info?: { imageUrl?: string };
  liquidity?: { usd?: number };
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const addressesParam = searchParams.get("addresses");

  if (!addressesParam) {
    return NextResponse.json(
      { error: "Missing addresses parameter" },
      { status: 400 }
    );
  }

  const addresses = addressesParam.split(",").map((a) => a.toLowerCase());
  const result: Record<string, TokenMeta> = {};

  // Init with nulls
  for (const addr of addresses) {
    result[addr] = {
      priceChange1h: null,
      priceChange24h: null,
      logoURI: KNOWN_LOGOS[addr] ?? null,
    };
  }

  try {
    // Fetch from DexScreener in chunks of 30
    const CHUNK = 30;
    for (let i = 0; i < addresses.length; i += CHUNK) {
      const chunk = addresses.slice(i, i + CHUNK);
      const url = `${DEXSCREENER_BASE}/tokens/v1/base/${chunk.join(",")}`;
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (!res.ok) continue;

      const pairs = (await res.json()) as DexPair[];

      // For each token, pick the pair with the highest liquidity
      const bestPairs: Record<string, DexPair> = {};
      for (const p of pairs) {
        const addr = p.baseToken?.address?.toLowerCase();
        if (!addr || !addresses.includes(addr)) continue;

        const liq = p.liquidity?.usd ?? 0;
        const existing = bestPairs[addr];
        if (!existing || liq > (existing.liquidity?.usd ?? 0)) {
          bestPairs[addr] = p;
        }
      }

      for (const [addr, pair] of Object.entries(bestPairs)) {
        result[addr] = {
          priceChange1h: pair.priceChange?.h1 ?? null,
          priceChange24h: pair.priceChange?.h24 ?? null,
          logoURI:
            pair.info?.imageUrl ?? KNOWN_LOGOS[addr] ?? null,
        };
      }
    }
  } catch (e) {
    console.error("Token meta fetch error:", e);
  }

  return NextResponse.json(result);
}
