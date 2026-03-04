import { NextRequest, NextResponse } from "next/server";
import { triggers } from "@/lib/db";
import { checkRateLimit, verifyApiKey } from "@/lib/api-security";
import {
  badRequest,
  unauthorized,
  notFound,
  isValidAddress,
  isValidTxHash,
  normalizeAddress,
  parseAddress,
} from "@/lib/api-utils";
import { log } from "@/lib/logger";

export type Trigger = {
  id: string;
  pairId: string;
  userAddress: string;
  direction: "1to2" | "2to1";
  metric: "price" | "ratio";
  priceToken?: string;
  type: "gte" | "lte" | "eq";
  value: number;
  fromToken: string;
  toToken: string;
  autoEnabled: boolean;
  amountMode?: "percent" | "tokens";
  amount?: number;
  status?: "active" | "triggered" | "disabled";
  lastTriggered?: string;
  txHash?: string;
  autoTaskId?: string;
};

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(request, 60);
  if (rl) return rl;

  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const pairId = searchParams.get("pairId");
  const autoEnabled = searchParams.get("autoEnabled");

  // S4: autoEnabled=true — requires API key
  if (autoEnabled === "true") {
    if (!verifyApiKey(request)) {
      return unauthorized("API key required for autoEnabled queries");
    }
    return NextResponse.json(triggers.getAutoEnabled());
  }

  if (!address) return badRequest("Missing address");
  const addr = parseAddress(address);
  if (!addr) return badRequest("Invalid address format");

  return NextResponse.json(
    triggers.getByUser(addr, pairId ?? undefined)
  );
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  const body = await request.json();
  const {
    pairId, userAddress, direction, metric, priceToken,
    type, value, fromToken, toToken, autoEnabled, amountMode, amount,
  } = body;

  if (!pairId || !userAddress || !direction || !type || value == null || !fromToken || !toToken) {
    return badRequest("Missing required fields");
  }
  if (!isValidAddress(userAddress)) return badRequest("Invalid userAddress");
  if (!isValidAddress(fromToken)) return badRequest("Invalid fromToken address");
  if (!isValidAddress(toToken)) return badRequest("Invalid toToken address");
  if (priceToken && !isValidAddress(priceToken)) return badRequest("Invalid priceToken address");

  const numValue = Number(value);
  if (!Number.isFinite(numValue) || numValue <= 0) {
    return badRequest("value must be a positive number");
  }
  if (!["1to2", "2to1"].includes(direction)) return badRequest("Invalid direction");

  if (amount != null) {
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return badRequest("amount must be a positive number");
    }
    if (amountMode === "percent" && numAmount > 100) {
      return badRequest("percent amount cannot exceed 100");
    }
  }

  const trigger = triggers.create({
    id: crypto.randomUUID(),
    pairId,
    userAddress: normalizeAddress(userAddress),
    direction,
    metric: metric === "price" ? "price" : "ratio",
    priceToken: priceToken ? normalizeAddress(priceToken) : undefined,
    type: ["gte", "lte", "eq"].includes(type) ? type : "gte",
    value: numValue,
    fromToken: normalizeAddress(fromToken),
    toToken: normalizeAddress(toToken),
    autoEnabled: !!autoEnabled,
    amountMode: amountMode || "percent",
    amount: amount != null ? Number(amount) : 100,
  });

  log.info("triggers", "Trigger created", { id: trigger.id, user: trigger.userAddress });
  return NextResponse.json(trigger);
}

export async function PATCH(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  const body = await request.json();
  const { id, userAddress, ...updates } = body;

  if (!id) return badRequest("Missing id");
  if (updates.txHash && !isValidTxHash(updates.txHash)) {
    return badRequest("Invalid txHash");
  }

  const existing = triggers.getById(id);
  if (!existing) return notFound("Trigger not found");

  // Authorization: checker (API key) or owner
  const isChecker = verifyApiKey(request);
  if (!isChecker) {
    if (!userAddress || existing.user_address !== normalizeAddress(userAddress)) {
      return unauthorized("Not authorized to modify this trigger");
    }
  }

  const result = triggers.update(id, {
    autoEnabled: updates.autoEnabled,
    status: updates.status,
    lastTriggered: updates.lastTriggered,
    txHash: updates.txHash,
    autoTaskId: updates.autoTaskId,
  });

  log.info("triggers", "Trigger updated", { id, updates: Object.keys(updates) });
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const userAddress = parseAddress(searchParams.get("userAddress"));

  if (!id) return badRequest("Missing id");

  const existing = triggers.getById(id);
  if (!existing) return notFound("Trigger not found");

  // Authorization: only owner
  if (!userAddress || existing.user_address !== userAddress) {
    return unauthorized("Not authorized to delete this trigger");
  }

  triggers.delete(id);
  log.info("triggers", "Trigger deleted", { id, user: userAddress });
  return NextResponse.json({ ok: true });
}
