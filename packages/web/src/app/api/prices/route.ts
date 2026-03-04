import { NextRequest, NextResponse } from "next/server";

// Primary: DexScreener (Base DEX pairs, 300 req/min, up to 30 addresses/req)
// Fallback 1: CoinGecko (for tokens without DEX pairs)
// Fallback 2: GeckoTerminal pools (opt-in via ?pool_fallback=true, for vault/wrapped tokens)

const DEXSCREENER_BASE = "https://api.dexscreener.com";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2";

const TOKEN_IDS: Record<string, string> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "usd-coin",
  "0x4200000000000000000000000000000000000006": "weth",
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "aerodrome-finance",
  "0x2ae3f1ec8989c8cf8f6180226674bcb15ee04531": "coinbase-wrapped-staked-eth",
  "0x4ed4e862860bed51a9570b96d89af5e1b0efefed": "degen-base",
  "0x0555e30da8f98308edb960aa94c0db47230d2b9c": "wrapped-bitcoin",
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": "wrapped-steth",
  "0x532f27101965dd16442e59d40670faf5ebb142e4": "brett-2",
  "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4": "toshi",
  "0xef5997c2cf2f6c138196f8a6203afc335206b3c1": "owb",
};

type DexPair = {
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
};

async function fetchDexScreenerPrices(addresses: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const CHUNK = 30;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const url = `${DEXSCREENER_BASE}/tokens/v1/base/${chunk.join(",")}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) continue;
    const pairs = (await res.json()) as DexPair[];
    for (const p of pairs) {
      const baseAddr = p.baseToken?.address?.toLowerCase();
      const quoteAddr = p.quoteToken?.address?.toLowerCase();
      const priceUsd = p.priceUsd ? parseFloat(p.priceUsd) : 0;
      if (baseAddr && priceUsd > 0) {
        const curr = result[baseAddr];
        if (curr == null || curr === 0) result[baseAddr] = priceUsd;
      }
      if (quoteAddr && (quoteAddr === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" || quoteAddr === "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca")) {
        result[quoteAddr] = 1;
      }
    }
  }
  return result;
}

/** Fetch price from GeckoTerminal pools for a single token */
async function fetchPoolPrice(addr: string): Promise<number> {
  try {
    const r = await fetch(
      `${GECKOTERMINAL_BASE}/networks/base/tokens/${addr}/pools?page=1`,
      { next: { revalidate: 120 } }
    );
    if (!r.ok) return 0;
    const data = (await r.json()) as {
      data?: Array<{
        attributes?: {
          base_token_price_usd?: string;
          quote_token_price_usd?: string;
        };
        relationships?: {
          base_token?: { data?: { id?: string } };
          quote_token?: { data?: { id?: string } };
        };
      }>;
    };
    for (const pool of data?.data ?? []) {
      const baseId = (pool.relationships?.base_token?.data?.id ?? "").toLowerCase();
      const quoteId = (pool.relationships?.quote_token?.data?.id ?? "").toLowerCase();
      const basePrice = parseFloat(pool.attributes?.base_token_price_usd ?? "0");
      const quotePrice = parseFloat(pool.attributes?.quote_token_price_usd ?? "0");
      if (baseId.endsWith(addr) && basePrice > 0) return basePrice;
      if (quoteId.endsWith(addr) && quotePrice > 0) return quotePrice;
    }
  } catch {
    // skip
  }
  return 0;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const addressesParam = searchParams.get("addresses");
  const usePoolFallback = searchParams.get("pool_fallback") === "true";

  if (!addressesParam) {
    return NextResponse.json(
      { error: "Missing addresses parameter" },
      { status: 400 }
    );
  }

  const addresses = addressesParam.split(",").map((a) => a.toLowerCase());
  const result: Record<string, number> = {};
  addresses.forEach((a) => {
    result[a] = 0;
  });

  try {
    // Step 1: DexScreener
    const dexPrices = await fetchDexScreenerPrices(addresses);
    for (const addr of addresses) {
      if (dexPrices[addr] && dexPrices[addr] > 0) {
        result[addr] = dexPrices[addr];
      }
    }

    // Step 2: CoinGecko for tokens not found on DexScreener
    const missing = addresses.filter((a) => !result[a] || result[a] === 0);
    if (missing.length > 0) {
      const byId = missing.filter((a) => TOKEN_IDS[a]);
      const byContract = missing.filter((a) => !TOKEN_IDS[a]);

      const [idsData, contractData] = await Promise.all([
        byId.length > 0
          ? fetch(
              `${COINGECKO_BASE}/simple/price?ids=${byId
                .map((a) => TOKEN_IDS[a])
                .join(",")}&vs_currencies=usd`,
              { next: { revalidate: 60 } }
            ).then((r) => (r.ok ? r.json() : {}))
          : Promise.resolve({}),
        byContract.length > 0
          ? fetch(
              `${COINGECKO_BASE}/simple/token_price/base?contract_addresses=${byContract.join(",")}&vs_currencies=usd`,
              { next: { revalidate: 60 } }
            ).then((r) => (r.ok ? r.json() : {}))
          : Promise.resolve({}),
      ]);

      const idsRes = idsData as Record<string, { usd?: number }>;
      const contractRes = contractData as Record<string, { usd?: number }>;

      for (const addr of byId) {
        const id = TOKEN_IDS[addr];
        if (!result[addr] && id) result[addr] = idsRes[id]?.usd ?? 0;
      }
      const contractKeys = Object.keys(contractRes);
      const addrToKey = new Map(
        contractKeys.map((k) => [k.toLowerCase(), k] as const)
      );
      for (const addr of byContract) {
        if (result[addr]) continue;
        const key = addrToKey.get(addr) ?? addrToKey.get(addr.toLowerCase());
        result[addr] = key ? (contractRes[key]?.usd ?? 0) : 0;
      }
    }

    // Step 3: GeckoTerminal pools (only when pool_fallback=true)
    // Used for targeted small requests (vault/wrapped tokens not on DEX aggregators)
    if (usePoolFallback) {
      const stillMissing = addresses.filter((a) => !result[a] || result[a] === 0);
      // Run sequentially to avoid GeckoTerminal rate limits (30 req/min)
      for (const addr of stillMissing) {
        const price = await fetchPoolPrice(addr);
        if (price > 0) result[addr] = price;
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("Price fetch error:", e);
    return NextResponse.json(result);
  }
}
