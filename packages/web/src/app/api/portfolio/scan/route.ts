import { NextRequest, NextResponse } from "next/server";
import { checkScamBatch } from "@/lib/scam-check";

// Alchemy: returns all ERC20 token balances for an address on Base
// Requires ALCHEMY_API_KEY in env (free tier at alchemy.com)

const ALCHEMY_BASE = "https://base-mainnet.g.alchemy.com/v2";

export type ScannedToken = {
  address: string;
  balance: string;
  balanceFormatted: number;
  decimals: number;
  symbol: string;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("address")?.trim();
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json(
      { error: "Missing or invalid address" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ALCHEMY_API_KEY not configured", tokens: [] },
      { status: 200 }
    );
  }

  try {
    const allTokenBalances: Array<{
      contractAddress: string;
      tokenBalance: string;
      error?: string;
    }> = [];
    let pageKey: string | undefined;

    do {
      const params: [string, string, { pageKey?: string }?] = [
        walletAddress,
        "erc20",
      ];
      if (pageKey) params[2] = { pageKey };

      const res = await fetch(`${ALCHEMY_BASE}/${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "alchemy_getTokenBalances",
          params,
          id: 1,
        }),
        next: { revalidate: 30 },
      });

      if (!res.ok) {
        throw new Error(`Alchemy error: ${res.status}`);
      }

      const data = (await res.json()) as {
        result?: {
          tokenBalances?: Array<{
            contractAddress: string;
            tokenBalance: string;
            error?: string;
          }>;
          pageKey?: string;
        };
      };

      const batch = data.result?.tokenBalances ?? [];
      allTokenBalances.push(...batch);
      pageKey = data.result?.pageKey;
    } while (pageKey);

    // Deduplicate by contract address (pagination may return same token on multiple pages)
    const seen = new Set<string>();
    const tokenBalances = allTokenBalances.filter((t) => {
      const key = t.contractAddress.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const withBalance = tokenBalances.filter(
      (t) =>
        !t.error &&
        t.tokenBalance &&
        t.tokenBalance !== "0x0000000000000000000000000000000000000000000000000000000000000000"
    );

    if (withBalance.length === 0) {
      return NextResponse.json({ tokens: [] });
    }

    const KNOWN: Record<string, { symbol: string; decimals: number }> = {
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
        symbol: "USDC",
        decimals: 6,
      },
      "0x4200000000000000000000000000000000000006": {
        symbol: "WETH",
        decimals: 18,
      },
      "0x940181a94a35a4569e4529a3cdfb74e38fd98631": { symbol: "AERO", decimals: 18 },
      "0x2ae3f1ec8989c8cf8f6180226674bcb15ee04531": {
        symbol: "cbETH",
        decimals: 18,
      },
      "0x4ed4e862860bed51a9570b96d89af5e1b0efefed": {
        symbol: "DEGEN",
        decimals: 18,
      },
      "0x0555e30da8f98308edb960aa94c0db47230d2b9c": { symbol: "WBTC", decimals: 8 },
      "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": {
        symbol: "wstETH",
        decimals: 18,
      },
      "0x532f27101965dd16442e59d40670faf5ebb142e4": {
        symbol: "BRETT",
        decimals: 18,
      },
      "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4": {
        symbol: "TOSHI",
        decimals: 18,
      },
      "0xef5997c2cf2f6c138196f8a6203afc335206b3c1": { symbol: "OWB", decimals: 18 },
    };

    const unknownAddrs = withBalance
      .map((t) => t.contractAddress.toLowerCase())
      .filter((addr) => !KNOWN[addr]);

    const metadataMap: Record<string, { symbol: string; decimals: number }> = {};
    if (unknownAddrs.length > 0) {
      // Batch metadata requests in chunks of 10 to avoid rate limiting
      const BATCH_SIZE = 10;
      for (let i = 0; i < unknownAddrs.length; i += BATCH_SIZE) {
        const batch = unknownAddrs.slice(i, i + BATCH_SIZE);
        const metaResults = await Promise.all(
          batch.map((addr) =>
            fetch(`${ALCHEMY_BASE}/${apiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "alchemy_getTokenMetadata",
                params: [addr],
                id: 1,
              }),
            }).then(async (r) => {
              try {
                const j = (await r.json()) as {
                  result?: { symbol?: string | null; decimals?: number | null };
                };
                const s = j.result?.symbol ?? "???";
                const d = typeof j.result?.decimals === "number" ? j.result.decimals : 18;
                return { addr, symbol: s, decimals: d };
              } catch {
                return { addr, symbol: "???", decimals: 18 };
              }
            }).catch(() => ({ addr, symbol: "???", decimals: 18 }))
          )
        );
        for (const m of metaResults) {
          metadataMap[m.addr] = { symbol: m.symbol, decimals: m.decimals };
        }
      }
    }

    // Filter out obvious spam/scam tokens by symbol patterns
    const SPAM_PATTERNS = [
      /claim/i, /visit/i, /airdrop/i, /reward/i, /redeem/i,
      /http/i, /www\./i, /\.com/i, /\.org/i, /\.net/i, /\.xyz/i,
      /\.live/i, /\.pro/i, /\.gg/i, /\.cc/i, /\.us/i, /\.fi\b/i,
      /t\.me/i, /t\.ly/i, /fli\.so/i, /jpeg\.ly/i, /telegram/i,
      /swap\b/i, /collect/i, /grab\b/i,
      /UЅDС/i, // fake USDC with Cyrillic chars
      /\$\s*Pool/i, // "$ Pool on ..."
      /\bclaim\b/i,
    ];

    function isSpam(symbol: string): boolean {
      return SPAM_PATTERNS.some((p) => p.test(symbol));
    }

    // Build candidate list (after symbol spam filter)
    const candidates: Array<{
      contractAddress: string;
      tokenBalance: string;
      meta: { symbol: string; decimals: number };
    }> = [];
    for (const t of withBalance) {
      const addr = t.contractAddress.toLowerCase();
      const meta = KNOWN[addr] ?? metadataMap[addr] ?? { symbol: "???", decimals: 18 };
      if (isSpam(meta.symbol)) continue;
      candidates.push({ contractAddress: t.contractAddress, tokenBalance: t.tokenBalance, meta });
    }

    // GoPlus scam check (cache-first, then API for uncached)
    const knownSafe = new Set(Object.keys(KNOWN).map((k) => k.toLowerCase()));
    const toCheck = candidates
      .map((c) => c.contractAddress.toLowerCase())
      .filter((addr) => !knownSafe.has(addr));
    const scamMap = toCheck.length > 0 ? await checkScamBatch(toCheck, "8453") : new Map<string, boolean>();

    const tokens: ScannedToken[] = [];
    for (const t of candidates) {
      const addr = t.contractAddress.toLowerCase();
      if (scamMap.get(addr)) continue;

      const balanceBig = BigInt(t.tokenBalance);
      const balanceFormatted = Number(
        (Number(balanceBig) / 10 ** t.meta.decimals).toPrecision(12)
      );
      if (balanceFormatted <= 0) continue;

      tokens.push({
        address: t.contractAddress,
        balance: t.tokenBalance,
        balanceFormatted,
        decimals: t.meta.decimals,
        symbol: t.meta.symbol,
      });
    }

    return NextResponse.json({ tokens });
  } catch (e) {
    console.error("Portfolio scan error:", e);
    return NextResponse.json(
      { error: "Scan failed", tokens: [] },
      { status: 200 }
    );
  }
}
