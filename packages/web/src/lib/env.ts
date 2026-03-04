/**
 * A3: Environment variable validation with Zod
 * Validates all required env vars at import time.
 * If validation fails, the app crashes immediately with a clear error.
 */

import { z } from "zod";

const ethAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a valid Ethereum address");

const serverEnvSchema = z.object({
  // Required
  ALCHEMY_API_KEY: z.string().min(1, "ALCHEMY_API_KEY is required"),
  INTERNAL_API_KEY: z
    .string()
    .min(32, "INTERNAL_API_KEY must be at least 32 characters"),

  // Public (available in browser)
  NEXT_PUBLIC_VAULT_ADDRESS: ethAddress,

  // Optional with defaults
  BASE_RPC_URL: z.string().url().optional().default("https://mainnet.base.org"),
  PRIVATE_KEY: z.string().optional(),

  // AI Advisor
  AI_ADVISOR_URL: z.string().url().optional().default("http://127.0.0.1:8000"),
  AI_SERVICE_SECRET: z.string().min(8).optional().default(""),
});

// Only validate on server side (API routes / SSR)
let _env: z.infer<typeof serverEnvSchema> | null = null;

export function getEnv() {
  if (_env) return _env;
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`\n❌ Environment validation failed:\n${formatted}\n`);
    throw new Error(`Missing or invalid environment variables:\n${formatted}`);
  }
  _env = result.data;
  return _env;
}
