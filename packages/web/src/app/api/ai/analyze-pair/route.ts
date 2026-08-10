import { NextRequest, NextResponse } from "next/server";
import { callAiAdvisor, convertKeysToSnake } from "@/lib/ai-client";
import { log } from "@/lib/logger";

/**
 * POST /api/ai/analyze-pair — statistical profile + backtest for a token pair.
 *
 * Unlike /api/ai/recommend (snapshot heuristics), this runs on real OHLCV
 * history: cointegration, spread z-score, half-life, and a cost-aware backtest
 * of threshold rebalancing versus simply holding.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const snake = convertKeysToSnake(body) as Record<string, unknown>;
    const result = await callAiAdvisor("/ai/analyze-pair", snake);
    return NextResponse.json(result);
  } catch (err) {
    log.error("ai_analyze_pair", "Analyze failed", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: "Pair analysis failed", detail: String(err) },
      { status: 200 }
    );
  }
}
