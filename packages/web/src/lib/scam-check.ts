/**
 * Scam token detection via GoPlus Security API + local SQLite cache.
 * Cache-first: check our DB before calling GoPlus.
 */

import { tokenScamCache } from "./db";

const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";
const BASE_CHAIN_ID = "8453"; // Base Mainnet
const BATCH_SIZE = 20; // GoPlus accepts multiple addresses per request
const CACHE_TTL_DAYS = 30; // Re-check after 30 days (optional, we keep forever for now)

type GoPlusResult = {
  is_honeypot?: string;
  is_airdrop_scam?: string;
  fake_token?: { value?: number };
  trust_list?: string; // "1" = trusted, can ignore other risks
};

function isScamFromGoPlus(data: GoPlusResult): boolean {
  if (data.trust_list === "1") return false; // Trusted token
  if (data.is_honeypot === "1") return true;
  if (data.is_airdrop_scam === "1") return true;
  if (data.fake_token?.value === 1) return true;
  return false;
}

/** Check addresses via cache + GoPlus, return Map: addr -> isScam */
export async function checkScamBatch(
  addresses: string[],
  chainId: string = BASE_CHAIN_ID
): Promise<Map<string, boolean>> {
  const lower = addresses.map((a) => a.toLowerCase());
  const result = new Map<string, boolean>();

  // 1. Check cache
  const cached = tokenScamCache.getBatch(lower, chainId);
  const uncached: string[] = [];
  for (const addr of lower) {
    const v = cached.get(addr);
    if (v !== undefined) {
      result.set(addr, v);
    } else {
      uncached.push(addr);
    }
  }

  if (uncached.length === 0) return result;

  const apiKey = process.env.GOPLUS_API_KEY;
  if (!apiKey) {
    // No API key: treat uncached as safe (we don't know)
    return result;
  }

  // 2. Call GoPlus in batches
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const contractAddresses = batch.join(",");

    try {
      const url = `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${encodeURIComponent(contractAddresses)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        next: { revalidate: 0 },
      });

      if (!res.ok) {
        console.warn("[scam-check] GoPlus error:", res.status, await res.text());
        continue;
      }

      const json = (await res.json()) as {
        code?: number;
        result?: Record<string, GoPlusResult>;
      };

      if (json.code !== 1 || !json.result) continue;

      const toCache: Array<{ address: string; isScam: boolean }> = [];
      const resultKeys = Object.keys(json.result);
      const addrToKey = new Map<string, string>();
      for (const k of resultKeys) {
        addrToKey.set(k.toLowerCase(), k);
      }
      for (const addr of batch) {
        const key = addrToKey.get(addr) ?? addr;
        const data = json.result[key];
        const isScam = data ? isScamFromGoPlus(data) : false;
        result.set(addr, isScam);
        toCache.push({ address: addr, isScam });
      }
      tokenScamCache.upsertBatch(toCache, chainId);
    } catch (e) {
      console.warn("[scam-check] GoPlus request failed:", e);
    }

    // Respect rate limit: ~30 req/min
    if (i + BATCH_SIZE < uncached.length) {
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  return result;
}
