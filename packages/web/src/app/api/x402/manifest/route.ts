import { NextResponse } from "next/server";
import {
  X402_PAY_TO,
  X402_NETWORK,
  X402_SIGNAL_PRICE,
} from "@/lib/x402-config";

/**
 * GET /api/x402/manifest — free service discovery for autonomous agents.
 *
 * Describes the x402-paid endpoints this service exposes, so an agent can
 * decide whether to call (and pay for) them without a signup flow.
 */
export async function GET() {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || "https://tokenrebalancer.com";

  return NextResponse.json({
    name: "Rebalancer",
    description:
      "Non-custodial token rebalancing on Base. Agents can buy AI rebalancing signals per call via x402, and execute trades through user-owned vaults that cap slippage on-chain.",
    protocol: "x402",
    network: X402_NETWORK,
    payTo: X402_PAY_TO,
    services: [
      {
        endpoint: `${base}/api/x402/signal`,
        method: "POST",
        price: X402_SIGNAL_PRICE,
        description:
          "AI rebalancing signal for a Base token pair: action, expected edge (bps), market regime, suggested triggers.",
        input: {
          tokenA: "0x… (Base ERC-20 address, required)",
          tokenB: "0x… (Base ERC-20 address, required)",
          symbolA: "string (optional)",
          symbolB: "string (optional)",
          balanceA: "number (optional, current holding)",
          balanceB: "number (optional, current holding)",
        },
        output: {
          action: "HOLD | REBALANCE_NOW | SUGGEST_TRIGGERS",
          regime: "MEAN_REVERSION | TREND | NEUTRAL",
          expected_edge_bps: "number",
          cost_bps: "number",
          rationale: "string",
          suggested_triggers: "array",
        },
      },
    ],
    docs: `${base}/agents`,
  });
}
