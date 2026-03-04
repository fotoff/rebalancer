/**
 * API Security Utilities
 * - API key authentication (for trigger-checker → API)
 * - Rate limiting (in-memory, per-IP)
 *
 * Note: address validation and file locking moved out.
 *   - Validation → api-utils.ts (A2/A4/A5)
 *   - File locking removed — SQLite handles concurrency via WAL mode (A1)
 */

import { NextRequest } from "next/server";
import { rateLimited, unauthorized } from "./api-utils";

// ─── API Key authentication ──────────────────────────────
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export function verifyApiKey(request: NextRequest): boolean {
  if (!INTERNAL_API_KEY) return false;
  const key = request.headers.get("x-api-key");
  return key === INTERNAL_API_KEY;
}

export function requireApiKey(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return unauthorized("API key required");
  }
  return null; // OK
}

// ─── Rate Limiting (in-memory, per-IP) ───────────────────
type RateLimitEntry = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 60_000);

/**
 * Check rate limit for a request.
 * Returns a 429 NextResponse if limited, null otherwise.
 */
export function checkRateLimit(
  request: NextRequest,
  limit = 30,
  windowMs = 60_000
) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const path = new URL(request.url).pathname;
  const key = `${ip}:${path}`;

  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;
  if (entry.count > limit) {
    return rateLimited(Math.ceil((entry.resetAt - now) / 1000));
  }

  return null;
}
