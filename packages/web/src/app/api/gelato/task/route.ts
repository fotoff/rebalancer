import { NextRequest, NextResponse } from "next/server";
import { triggers } from "@/lib/db";
import { checkRateLimit } from "@/lib/api-security";
import { badRequest, unauthorized, notFound } from "@/lib/api-utils";
import { log } from "@/lib/logger";

/**
 * Auto-Rebalance Task Management API
 *
 * POST — Enable auto-mode for a trigger
 * DELETE — Disable auto-mode for a trigger
 */

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  try {
    const { triggerId, userAddress } = await request.json();
    if (!triggerId) return badRequest("Missing triggerId");

    const existing = triggers.getById(triggerId);
    if (!existing) return notFound("Trigger not found");

    // Authorization: only owner
    if (
      !userAddress ||
      existing.user_address !== userAddress.toLowerCase()
    ) {
      return unauthorized("Not authorized to modify this trigger");
    }

    const taskId = `auto-${triggerId.slice(0, 12)}`;
    triggers.update(triggerId, {
      autoEnabled: true,
      autoTaskId: taskId,
      status: "active",
    });

    log.info("auto-task", "Auto-mode enabled", { triggerId, user: userAddress });
    return NextResponse.json({
      ok: true,
      triggerId,
      taskId,
      message: "Auto-mode enabled. Self-hosted checker monitors this trigger every 5 min.",
    });
  } catch (err) {
    log.error("auto-task", "Create error", { error: String(err) });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const rl = checkRateLimit(request, 20);
  if (rl) return rl;

  try {
    const { searchParams } = new URL(request.url);
    const triggerId = searchParams.get("triggerId");
    const userAddress = searchParams.get("userAddress");
    if (!triggerId) return badRequest("Missing triggerId");

    const existing = triggers.getById(triggerId);
    if (!existing) return notFound("Trigger not found");

    // Authorization: only owner
    if (
      !userAddress ||
      existing.user_address !== userAddress.toLowerCase()
    ) {
      return unauthorized("Not authorized to modify this trigger");
    }

    triggers.update(triggerId, {
      autoEnabled: false,
      autoTaskId: undefined,
      status: "disabled",
    });

    log.info("auto-task", "Auto-mode disabled", { triggerId, user: userAddress });
    return NextResponse.json({
      ok: true,
      triggerId,
      message: "Auto-mode disabled.",
    });
  } catch (err) {
    log.error("auto-task", "Delete error", { error: String(err) });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
      { status: 500 }
    );
  }
}
