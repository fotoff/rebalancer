import { NextRequest, NextResponse } from "next/server";

const GECKO_BASE = "https://api.geckoterminal.com/api/v2";

type Pool = {
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
  attributes?: { name?: string };
};

function parseTokenId(id: string): string | null {
  // id format: "base_0x..."
  const match = id?.match(/^base_(0x[a-fA-F0-9]{40})$/);
  return match ? match[1].toLowerCase() : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const res = await fetch(
      `${GECKO_BASE}/search/pools?query=${encodeURIComponent(q)}&network=base`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return NextResponse.json([]);

    const json = (await res.json()) as { data?: Pool[] };
    const pools = json.data ?? [];
    const seen = new Set<string>();
    const tokens: { address: string; symbol: string }[] = [];

    for (const pool of pools.slice(0, 20)) {
      const name = pool.attributes?.name ?? "";
      const parts = name.split(" / ");
      const baseId = pool.relationships?.base_token?.data?.id;
      const quoteId = pool.relationships?.quote_token?.data?.id;

      if (baseId) {
        const addr = parseTokenId(baseId);
        if (addr && !seen.has(addr)) {
          seen.add(addr);
          tokens.push({
            address: addr,
            symbol: parts[0]?.trim() || "???",
          });
        }
      }
      if (quoteId) {
        const addr = parseTokenId(quoteId);
        if (addr && !seen.has(addr)) {
          seen.add(addr);
          tokens.push({
            address: addr,
            symbol: parts[1]?.trim() || "???",
          });
        }
      }
    }

    return NextResponse.json(tokens);
  } catch {
    return NextResponse.json([]);
  }
}
