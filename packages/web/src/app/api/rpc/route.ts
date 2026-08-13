import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/logger";

/**
 * JSON-RPC proxy for the browser.
 *
 * The client used to talk to public Base endpoints directly. They rate-limit
 * hard, and when all of them refuse at once viem reports "No internet
 * connection detected" — which sent a user chasing a network problem that was
 * never theirs. Proxying through our own provider gives them a node that
 * answers, without shipping the API key to the browser.
 *
 * Reads only. Signing and broadcasting happen in the user's wallet through its
 * own transport, so nothing here needs to accept a raw transaction — and an
 * open relay is exactly what a public proxy must not be.
 */

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
  "web3_clientVersion",
]);

const MAX_BATCH = 30;

function upstream() {
  return (
    process.env.BASE_RPC_URL ||
    (process.env.ALCHEMY_API_KEY
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : "https://mainnet.base.org")
  );
}

function rejected(id: unknown, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message } };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > MAX_BATCH) {
    return NextResponse.json({ error: "Batch too large" }, { status: 413 });
  }

  // Refuse the whole request if any call is out of scope, rather than silently
  // dropping one and returning a batch the caller cannot line up with its input.
  const blocked = calls.find(
    (c) => !ALLOWED.has((c as { method?: string })?.method ?? "")
  );
  if (blocked) {
    const m = (blocked as { method?: string }).method ?? "unknown";
    return NextResponse.json(
      rejected((blocked as { id?: unknown }).id, `Method not proxied: ${m}`),
      { status: 200 }
    );
  }

  try {
    const res = await fetch(upstream(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    log.error("rpc-proxy", "upstream failed", { error: String(err) });
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Upstream RPC unavailable" } },
      { status: 200 }
    );
  }
}
