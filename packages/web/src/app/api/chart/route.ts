import { NextRequest, NextResponse } from "next/server";

// GeckoTerminal API: DEX OHLCV data (covers Base tokens including OWB)
const GEKKO_BASE = "https://api.geckoterminal.com/api/v2";
const NETWORK = "base";

type PoolItem = {
  id: string;
  attributes?: {
    address?: string;
    reserve_in_usd?: number;
    base_token_price_usd?: string;
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
};

async function getBestPoolForToken(tokenAddr: string): Promise<string | null> {
  const url = `${GEKKO_BASE}/networks/${NETWORK}/tokens/${tokenAddr.toLowerCase()}/pools`;
  const res = await fetch(url, {
    headers: { Accept: "application/json;version=20230203" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: PoolItem[] };
  const pools = json.data ?? [];
  const sorted = pools
    .filter((p) => {
      const reserve = p.attributes?.reserve_in_usd ?? 0;
      return reserve > 100;
    })
    .sort((a, b) => (b.attributes?.reserve_in_usd ?? 0) - (a.attributes?.reserve_in_usd ?? 0));
  const best = sorted[0];
  return best?.attributes?.address ?? null;
}

async function fetchOhlcv(poolAddr: string, timeframe = "day") {
  const url = `${GEKKO_BASE}/networks/${NETWORK}/pools/${poolAddr}/ohlcv/${timeframe}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json;version=20230203" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
  };
  const list = json.data?.attributes?.ohlcv_list ?? [];
  return list; // [ts, open, high, low, close, volume]
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const addressesParam = searchParams.get("addresses");
  const days = Math.min(90, Math.max(7, parseInt(searchParams.get("days") ?? "30", 10)));
  if (!addressesParam) {
    return NextResponse.json(
      { error: "Missing addresses parameter" },
      { status: 400 }
    );
  }

  const addresses = addressesParam.split(",").map((a) => a.trim().toLowerCase());
  if (addresses.length === 0 || addresses.length > 2) {
    return NextResponse.json(
      { error: "Provide 1 or 2 token addresses" },
      { status: 400 }
    );
  }

  try {
    const poolAddrs: (string | null)[] = [];
    for (const addr of addresses) {
      const pool = await getBestPoolForToken(addr);
      poolAddrs.push(pool);
    }

    const ohlcvResults = await Promise.all(
      poolAddrs.map((p) => (p ? fetchOhlcv(p) : Promise.resolve([])))
    );

    const allTs = new Set<number>();
    for (const ohlcv of ohlcvResults) {
      for (const [ts] of ohlcv) allTs.add(ts);
    }
    const sortedTs = Array.from(allTs).sort((a, b) => a - b);
    const cutoff = Date.now() / 1000 - days * 86400;
    const filteredTs = sortedTs.filter((t) => t >= cutoff);
    if (filteredTs.length === 0) {
      return NextResponse.json({ data: [], labels: addresses });
    }

    const interpolate = (
      ohlcv: [number, number, number, number, number, number][],
      ts: number
    ): number => {
      const sorted = [...ohlcv].sort((a, b) => a[0] - b[0]);
      const idx = sorted.findIndex(([t]) => t >= ts);
      if (idx === 0) return sorted[0][4];
      if (idx < 0) return sorted[sorted.length - 1][4];
      const [t0, , , , c0] = sorted[idx - 1];
      const [t1, , , , c1] = sorted[idx];
      const alpha = (ts - t0) / (t1 - t0 || 1);
      return c0 + alpha * (c1 - c0);
    };

    const base1 = ohlcvResults[0].length
      ? interpolate(ohlcvResults[0], filteredTs[0])
      : 1;
    const base2 = ohlcvResults[1]?.length
      ? interpolate(ohlcvResults[1], filteredTs[0])
      : 1;

    const data = filteredTs.map((ts) => {
      const p1 = ohlcvResults[0].length ? interpolate(ohlcvResults[0], ts) : 0;
      const p2 = ohlcvResults[1]?.length ? interpolate(ohlcvResults[1], ts) : 0;
      const change1 = base1 > 0 ? ((p1 - base1) / base1) * 100 : 0;
      const change2 = base2 > 0 ? ((p2 - base2) / base2) * 100 : 0;
      return {
        timestamp: ts,
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        ...(addresses[0] && { [addresses[0]]: change1 }),
        ...(addresses[1] && { [addresses[1]]: change2 }),
      };
    });

    return NextResponse.json({
      data,
      labels: addresses,
    });
  } catch (e) {
    console.error("Chart fetch error:", e);
    return NextResponse.json(
      { error: "Chart fetch failed", data: [], labels: addresses },
      { status: 200 }
    );
  }
}
