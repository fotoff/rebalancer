import { NextRequest, NextResponse } from "next/server";
import { callAiAdvisor, convertKeysToSnake } from "@/lib/ai-client";
import { log } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const snakeBody = convertKeysToSnake(body) as Record<string, unknown>;
    const result = await callAiAdvisor("/ai/suggest-pairs", snakeBody);
    return NextResponse.json(result);
  } catch (err) {
    log.error("ai_suggest_pairs", "Suggest pairs failed", { error: String(err) });
    return NextResponse.json(
      { error: "AI suggest-pairs failed", detail: String(err) },
      { status: 502 }
    );
  }
}
