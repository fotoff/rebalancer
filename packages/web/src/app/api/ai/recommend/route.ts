import { NextRequest, NextResponse } from "next/server";
import { callAiAdvisor, convertKeysToSnake } from "@/lib/ai-client";
import { aiRecommendations } from "@/lib/db";
import { log } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const pair = body.pair ?? {};
    const ps = body.portfolio_slice ?? body.portfolioSlice ?? {};

    const aiBody: Record<string, unknown> = {
      chain_id: body.chainId ?? body.chain_id ?? 8453,
      pair: {
        token_a: pair.token_a ?? pair.tokenA ?? body.tokenA ?? body.token_a ?? "",
        token_b: pair.token_b ?? pair.tokenB ?? body.tokenB ?? body.token_b ?? "",
        symbol_a: pair.symbol_a ?? pair.symbolA ?? body.symbolA ?? body.symbol_a ?? "",
        symbol_b: pair.symbol_b ?? pair.symbolB ?? body.symbolB ?? body.symbol_b ?? "",
      },
      user_address: body.userAddress ?? body.user_address ?? "",
      pair_id: body.pairId ?? body.pair_id ?? "",
      portfolio_slice: {
        vault_balance_a: ps.vault_balance_a ?? ps.vaultBalanceA ?? body.vaultBalanceA ?? body.vault_balance_a ?? 0,
        vault_balance_b: ps.vault_balance_b ?? ps.vaultBalanceB ?? body.vaultBalanceB ?? body.vault_balance_b ?? 0,
      },
    };

    const result = await callAiAdvisor<Record<string, unknown>>(
      "/ai/recommend",
      aiBody
    );

    // Persist recommendation to DB for audit
    try {
      const recId = (result.recommendation_id as string) || "";
      const action = (result.action as string) || "HOLD";
      if (recId && body.user_address) {
        aiRecommendations.save({
          id: recId,
          userAddress: body.user_address,
          pairId: body.pair_id || "",
          chainId: body.chain_id || 8453,
          action,
          jsonPayload: JSON.stringify(result),
          modelVersion: (result.model_version as string) || "mvp-heuristic",
          featureVersion: (result.feature_version as string) || "1.0.0",
        });

        // Save violations
        const policy = result.policy as { violations?: Array<Record<string, unknown>> } | undefined;
        if (policy?.violations?.length) {
          aiRecommendations.saveViolations(
            recId,
            policy.violations.map((v) => ({
              code: (v.code as string) || "",
              severity: (v.severity as string) || "WARN",
              actual: (v.actual as number) || 0,
              limit: (v.limit as number) || 0,
              message: (v.message as string) || "",
            }))
          );
        }
      }
    } catch (dbErr) {
      log.error("ai_recommend", "Failed to save recommendation to DB", { error: String(dbErr) });
    }

    return NextResponse.json(result);
  } catch (err) {
    log.error("ai_recommend", "Recommendation failed", { error: String(err) });
    return NextResponse.json(
      { error: "AI recommendation failed", detail: String(err) },
      { status: 502 }
    );
  }
}
