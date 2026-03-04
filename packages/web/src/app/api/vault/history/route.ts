import { NextRequest, NextResponse } from "next/server";
import { vaultHistory } from "@/lib/db";
import { checkRateLimit, requireApiKey } from "@/lib/api-security";
import {
  badRequest,
  isValidAddress,
  isValidTxHash,
  normalizeAddress,
  parseAddress,
} from "@/lib/api-utils";
import { log } from "@/lib/logger";

export type VaultEvent = {
  id: string;
  userAddress: string;
  pairId?: string;
  type: "deposit" | "withdraw" | "rebalance";
  token: string;
  amount: string;
  fromToken?: string;
  toToken?: string;
  amountIn?: string;
  amountOut?: string;
  txHash?: string;
  timestamp: string;
};

/** Map DB row → frontend camelCase */
function toApi(e: {
  id: string;
  user_address: string;
  pair_id: string | null;
  type: string;
  token: string;
  amount: string;
  from_token: string | null;
  to_token: string | null;
  amount_in: string | null;
  amount_out: string | null;
  tx_hash: string | null;
  timestamp: string;
}): VaultEvent {
  return {
    id: e.id,
    userAddress: e.user_address,
    pairId: e.pair_id ?? undefined,
    type: e.type as VaultEvent["type"],
    token: e.token,
    amount: e.amount,
    fromToken: e.from_token ?? undefined,
    toToken: e.to_token ?? undefined,
    amountIn: e.amount_in ?? undefined,
    amountOut: e.amount_out ?? undefined,
    txHash: e.tx_hash ?? undefined,
    timestamp: e.timestamp,
  };
}

// GET — events for a user, optionally filtered by pairId
export async function GET(request: NextRequest) {
  const rl = checkRateLimit(request, 60);
  if (rl) return rl;

  const { searchParams } = new URL(request.url);
  const address = parseAddress(searchParams.get("address"));
  const pairId = searchParams.get("pairId")?.toLowerCase();

  if (!address) return badRequest("Missing or invalid address");

  let events;
  if (pairId) {
    events = vaultHistory.getByUserWithLegacyFilter(address, pairId);
  } else {
    events = vaultHistory.getByUser(address);
  }

  return NextResponse.json(events.map(toApi));
}

// POST — add a new vault event
// rebalance events require API key (only trigger-checker writes them)
// deposit/withdraw events come from the frontend (user's own actions)
export async function POST(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  const body = await request.json();
  const {
    userAddress, pairId, type, token, amount,
    fromToken, toToken, amountIn, amountOut, txHash,
  } = body;

  if (!userAddress || !type) return badRequest("userAddress and type required");

  // Rebalance events can only be created by trigger-checker (API key required)
  if (type === "rebalance") {
    const authErr = requireApiKey(request);
    if (authErr) return authErr;
  }
  if (!isValidAddress(userAddress)) return badRequest("Invalid userAddress");
  if (!["deposit", "withdraw", "rebalance"].includes(type)) {
    return badRequest("Invalid event type");
  }

  if ((type === "deposit" || type === "withdraw") && (!token || !amount)) {
    return badRequest("token and amount required for deposit/withdraw");
  }
  if (type === "rebalance" && (!fromToken || !toToken)) {
    return badRequest("fromToken and toToken required for rebalance");
  }
  if (token && !isValidAddress(token)) return badRequest("Invalid token address");
  if (fromToken && !isValidAddress(fromToken)) return badRequest("Invalid fromToken address");
  if (toToken && !isValidAddress(toToken)) return badRequest("Invalid toToken address");
  if (txHash && !isValidTxHash(txHash)) return badRequest("Invalid txHash");

  const event = vaultHistory.create({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_address: normalizeAddress(userAddress),
    pair_id: pairId?.toLowerCase() ?? null,
    type,
    token: token ? normalizeAddress(token) : "",
    amount: amount ?? "0",
    from_token: fromToken ? normalizeAddress(fromToken) : null,
    to_token: toToken ? normalizeAddress(toToken) : null,
    amount_in: amountIn ?? null,
    amount_out: amountOut ?? null,
    tx_hash: txHash ?? null,
    timestamp: new Date().toISOString(),
  });

  log.info("vault-history", "Event created", { id: event.id, type, user: event.user_address });
  return NextResponse.json(toApi(event), { status: 201 });
}
