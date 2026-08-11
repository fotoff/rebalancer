/**
 * x402 (HTTP 402 Payment Required) configuration.
 *
 * Lets autonomous agents pay per API call in USDC on Base instead of signing up
 * for an account. See https://x402.org — the protocol Coinbase built for
 * machine-to-machine payments.
 *
 * Mainnet ("base") settlement requires a facilitator that can broadcast the
 * payment. Coinbase's CDP facilitator does this and needs CDP API keys; without
 * them we fall back to the public testnet facilitator on base-sepolia so the
 * endpoint still works end-to-end for integrators.
 */

import type { Network } from "x402-next";
import type { FacilitatorConfig } from "x402/types";
import { createCdpAuthHeaders } from "@coinbase/x402";

/** Address that receives x402 payments (defaults to the protocol fee collector). */
export const X402_PAY_TO = (process.env.X402_PAY_TO ||
  "0x926B4b09Faf5F49e64180B37372c5963F2eA35b7") as `0x${string}`;

/** "base" for real USDC settlement, "base-sepolia" for free integration testing. */
export const X402_NETWORK = (process.env.X402_NETWORK || "base-sepolia") as Network;

/** Price per signal request, in USD (settled as USDC). */
export const X402_SIGNAL_PRICE = process.env.X402_SIGNAL_PRICE || "$0.01";

/**
 * CDP facilitator when keys are configured (required for Base mainnet), else
 * undefined → x402-next falls back to the public x402.org testnet facilitator.
 *
 * Uses the official @coinbase/x402 config rather than a hand-rolled header:
 * CDP authenticates with a JWT signed by the API key, so sending
 * `Bearer <id>:<secret>` — as this did — fails verification with an opaque
 * "unexpected_error" and no payment ever settles.
 */
export function getFacilitator(): FacilitatorConfig | undefined {
  const keyId = process.env.CDP_API_KEY_ID;
  const keySecret = process.env.CDP_API_KEY_SECRET;
  if (!keyId || !keySecret) return undefined;

  // Only the header generator is borrowed: @coinbase/x402 and x402/types ship
  // incompatible FacilitatorConfig shapes (its `url` is optional, ours is a
  // template literal), so the URL is stated here rather than fought over.
  return {
    url: "https://api.cdp.coinbase.com/platform/v2/x402",
    createAuthHeaders: createCdpAuthHeaders(keyId, keySecret),
  } as FacilitatorConfig;
}
