import { NextRequest, NextResponse } from "next/server";

const LIFI_QUOTE_URL = "https://li.quest/v1/quote";
const BASE_CHAIN_ID = "8453";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromToken = searchParams.get("fromToken");
    const toToken = searchParams.get("toToken");
    const fromAmount = searchParams.get("fromAmount");
    const fromAddress = searchParams.get("fromAddress");
    const slippage = searchParams.get("slippage") || "0.005";

    if (!fromToken || !toToken || !fromAmount || !fromAddress) {
      return NextResponse.json(
        { error: "Missing required params: fromToken, toToken, fromAmount, fromAddress" },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      fromChain: BASE_CHAIN_ID,
      toChain: BASE_CHAIN_ID,
      fromToken,
      toToken,
      fromAmount,
      fromAddress,
      slippage,
      order: "CHEAPEST",
    });

    const resp = await fetch(`${LIFI_QUOTE_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("LI.FI quote error:", resp.status, text);
      return NextResponse.json(
        { error: "LI.FI quote failed", detail: text },
        { status: resp.status }
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Swap quote error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
