import { NextRequest, NextResponse } from "next/server";
import { pairs } from "@/lib/db";
import { checkRateLimit } from "@/lib/api-security";
import {
  badRequest,
  unauthorized,
  isValidAddress,
  normalizeAddress,
  parseAddress,
} from "@/lib/api-utils";
import { log } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(request, 60);
  if (rl) return rl;

  const { searchParams } = new URL(request.url);
  const address = parseAddress(searchParams.get("address"));
  if (!address) return badRequest("Missing or invalid address");

  const userPairs = pairs.getByUser(address);

  // Map DB columns to frontend camelCase
  return NextResponse.json(
    userPairs.map((p) => ({
      id: p.id,
      userAddress: p.user_address,
      token1: p.token1,
      token2: p.token2,
      createdAt: p.created_at,
    }))
  );
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  const body = await request.json();
  const { userAddress, token1, token2 } = body;

  if (!userAddress || !token1 || !token2) {
    return badRequest("Missing userAddress, token1, or token2");
  }
  if (!isValidAddress(userAddress)) return badRequest("Invalid userAddress");
  if (!isValidAddress(token1)) return badRequest("Invalid token1 address");
  if (!isValidAddress(token2)) return badRequest("Invalid token2 address");

  const addr = normalizeAddress(userAddress);
  const t1 = normalizeAddress(token1);
  const t2 = normalizeAddress(token2);

  if (t1 === t2) return badRequest("token1 and token2 must differ");

  // Check for existing pair
  const existing = pairs.findDuplicate(addr, t1, t2);
  if (existing) {
    return NextResponse.json({
      id: existing.id,
      userAddress: existing.user_address,
      token1: existing.token1,
      token2: existing.token2,
      createdAt: existing.created_at,
    });
  }

  const pair = pairs.create({
    id: crypto.randomUUID(),
    user_address: addr,
    token1: t1,
    token2: t2,
    created_at: new Date().toISOString(),
  });

  log.info("pairs", "Pair created", { id: pair.id, user: addr });

  return NextResponse.json({
    id: pair.id,
    userAddress: pair.user_address,
    token1: pair.token1,
    token2: pair.token2,
    createdAt: pair.created_at,
  });
}

export async function DELETE(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const userAddress = parseAddress(searchParams.get("userAddress"));

  if (!id) return badRequest("Missing id");

  // Authorization: verify ownership
  const pair = pairs.getById(id);
  if (!pair) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  if (!userAddress || pair.user_address !== userAddress) {
    return unauthorized("Not authorized to delete this pair");
  }

  pairs.delete(id);
  log.info("pairs", "Pair deleted", { id, user: userAddress });
  return NextResponse.json({ ok: true });
}
