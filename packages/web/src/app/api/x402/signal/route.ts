import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "x402-next";
import { callAiAdvisor } from "@/lib/ai-client";
import { log } from "@/lib/logger";
import {
  X402_PAY_TO,
  X402_NETWORK,
  X402_SIGNAL_PRICE,
  getFacilitator,
} from "@/lib/x402-config";

/**
 * POST /api/x402/signal — paid rebalancing signal for any Base token pair.
 *
 * Pay-per-call in USDC via x402: no account, no API key. Built for autonomous
 * agents that need a rebalance decision for a pair they hold.
 *
 * Body: { tokenA, tokenB, symbolA?, symbolB?, balanceA?, balanceB? }
 * Returns a compact, machine-readable signal (action + edge + rationale).
 */
const handler = async (
  request: NextRequest
): Promise<NextResponse<unknown>> => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tokenA = String(body.tokenA ?? body.token_a ?? "");
  const tokenB = String(body.tokenB ?? body.token_b ?? "");
  const isAddr = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a);

  if (!isAddr(tokenA) || !isAddr(tokenB)) {
    return NextResponse.json(
      { error: "tokenA and tokenB must be valid Base ERC-20 addresses" },
      { status: 400 }
    );
  }
  if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
    return NextResponse.json({ error: "tokenA and tokenB must differ" }, { status: 400 });
  }

  try {
    const result = await callAiAdvisor<Record<string, unknown>>("/ai/recommend", {
      chain_id: 8453,
      pair: {
        token_a: tokenA,
        token_b: tokenB,
        symbol_a: String(body.symbolA ?? body.symbol_a ?? ""),
        symbol_b: String(body.symbolB ?? body.symbol_b ?? ""),
      },
      user_address: "",
      pair_id: "",
      portfolio_slice: {
        vault_balance_a: Number(body.balanceA ?? body.balance_a ?? 0),
        vault_balance_b: Number(body.balanceB ?? body.balance_b ?? 0),
      },
    });

    const expected = (result.expected ?? {}) as Record<string, unknown>;
    const explain = (result.explain ?? {}) as Record<string, unknown>;
    const policy = (result.policy ?? {}) as Record<string, unknown>;

    // Compact agent-facing shape — stable contract, not the raw internal payload.
    return NextResponse.json({
      pair: { tokenA, tokenB },
      action: result.action ?? "HOLD",
      regime: expected.regime ?? "NEUTRAL",
      expected_edge_bps: expected.expected_edge_bps ?? 0,
      cost_bps: expected.cost_bps ?? 0,
      p_win: expected.p_win ?? null,
      policy_passed: policy.passed ?? null,
      rationale: explain.short ?? "",
      suggested_triggers: result.triggers_suggestion ?? [],
      model_version: result.model_version ?? "mvp-heuristic",
      timestamp: result.timestamp ?? new Date().toISOString(),
    });
  } catch (err) {
    log.error("x402_signal", "Signal failed", { error: String(err) });
    // 5xx → x402 does not settle payment (wrapper settles only on status < 400)
    return NextResponse.json(
      { error: "Signal generation failed", detail: String(err) },
      { status: 502 }
    );
  }
};

export const POST = withX402(
  handler,
  X402_PAY_TO,
  {
    price: X402_SIGNAL_PRICE,
    network: X402_NETWORK,
    config: {
      description:
        "AI rebalancing signal for a Base token pair: action, expected edge (bps), market regime and suggested triggers.",
    },
  },
  getFacilitator()
);
