/**
 * A2: Unified API response helpers
 * A4: Address normalization
 * A5: Type guards for Ethereum types
 */

import { NextResponse } from "next/server";

// ─── A2: Unified error responses ─────────────────────────
type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

/**
 * Return a standardised JSON error response.
 * All API routes should use this instead of ad-hoc NextResponse.json({ error }).
 */
export function apiError(
  code: ErrorCode,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Shorthand: 400 validation error */
export function badRequest(message: string) {
  return apiError("VALIDATION_ERROR", message, 400);
}

/** Shorthand: 401 unauthorized */
export function unauthorized(message = "Unauthorized") {
  return apiError("UNAUTHORIZED", message, 401);
}

/** Shorthand: 404 not found */
export function notFound(message = "Not found") {
  return apiError("NOT_FOUND", message, 404);
}

/** Shorthand: 429 rate limited */
export function rateLimited(retryAfterSec: number) {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests" } },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    }
  );
}

/** Shorthand: 500 internal error */
export function internalError(message = "Internal error") {
  return apiError("INTERNAL_ERROR", message, 500);
}

// ─── A4: Address normalization ───────────────────────────
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Normalize an Ethereum address to lowercase.
 * All storage and comparisons should go through this.
 */
export function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

// ─── A5: Type guards ─────────────────────────────────────

/** Check if a string is a valid Ethereum address (0x + 40 hex) */
export function isValidAddress(value: string): boolean {
  return ETH_ADDRESS_RE.test(value);
}

/** Check if a string is a valid transaction hash (0x + 64 hex) */
export function isValidTxHash(value: string): boolean {
  return TX_HASH_RE.test(value);
}

/** Validate and normalize an address in one step; returns null if invalid */
export function parseAddress(value: string | null | undefined): string | null {
  if (!value || !isValidAddress(value)) return null;
  return normalizeAddress(value);
}
