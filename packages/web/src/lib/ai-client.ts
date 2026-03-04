/**
 * Client utility for calling ai-advisor service with HMAC authentication.
 */

import { createHmac } from "crypto";
import { getEnv } from "./env";
import { log } from "./logger";

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function convertKeysToSnake(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(convertKeysToSnake);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toSnakeCase(k),
        convertKeysToSnake(v),
      ])
    );
  }
  return obj;
}

function signRequest(body: string): { signature: string; timestamp: string } {
  const env = getEnv();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}.${body}`;
  const signature = createHmac("sha256", env.AI_SERVICE_SECRET)
    .update(message)
    .digest("hex");
  return { signature, timestamp };
}

export async function callAiAdvisor<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const env = getEnv();
  const baseUrl = env.AI_ADVISOR_URL;

  if (!baseUrl || !env.AI_SERVICE_SECRET) {
    throw new Error("AI Advisor not configured (AI_ADVISOR_URL / AI_SERVICE_SECRET)");
  }

  const jsonBody = JSON.stringify(body);
  const { signature, timestamp } = signRequest(jsonBody);

  const url = `${baseUrl}${endpoint}`;

  log.info("ai_client", `Calling ${url}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ai-signature": signature,
      "x-ai-timestamp": timestamp,
    },
    body: jsonBody,
  });

  if (!resp.ok) {
    const text = await resp.text();
    log.error("ai_client", `AI Advisor error: ${resp.status} ${text}`);
    throw new Error(`AI Advisor returned ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<T>;
}
