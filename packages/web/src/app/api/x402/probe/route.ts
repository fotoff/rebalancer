import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { callAiAdvisor } from "@/lib/ai-client";
import { log } from "@/lib/logger";
import { X402_SIGNAL_PRICE } from "@/lib/x402-config";

/**
 * Free probe: is there anything worth buying for this pair right now?
 *
 * Paying per poll made the cost track how often an agent asked rather than
 * whether there was anything to say — 112 payments returned "hold". An agent
 * can now ask for free and pay only when the answer is yes.
 *
 * Deliberately returns a bare boolean. Direction, size, min-out, edge and
 * rationale stay behind the paywall, because knowing *when* is only useful
 * alongside *which way* — and guessing that wrong costs far more than a cent.
 * The threshold itself is not disclosed either, so the flag cannot be inverted
 * into the underlying number.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tokenA = String(body.tokenA ?? body.token_a ?? "");
  const tokenB = String(body.tokenB ?? body.token_b ?? "");
  if (!isAddress(tokenA) || !isAddress(tokenB)) {
    return NextResponse.json(
      { error: "tokenA and tokenB must be addresses" },
      { status: 400 }
    );
  }
  if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
    return NextResponse.json(
      { error: "tokenA and tokenB must differ" },
      { status: 400 }
    );
  }

  try {
    const result = await callAiAdvisor<Record<string, unknown>>("/ai/recommend", {
      chain_id: 8453,
      pair: { token_a: tokenA, token_b: tokenB, symbol_a: "", symbol_b: "" },
      user_address: "",
      pair_id: "",
      portfolio_slice: { vault_balance_a: 0, vault_balance_b: 0 },
    });

    const action = String(result.action ?? "HOLD");

    return NextResponse.json({
      pair: { tokenA, tokenB },
      signal: action === "REBALANCE_NOW",
      price_if_you_want_it: X402_SIGNAL_PRICE,
      endpoint: "/api/x402/signal",
      as_of: result.timestamp ?? new Date().toISOString(),
    });
  } catch (err) {
    log.error("x402_probe", "Probe failed", { error: String(err) });
    return NextResponse.json(
      { error: "Probe failed", detail: String(err) },
      { status: 502 }
    );
  }
}
