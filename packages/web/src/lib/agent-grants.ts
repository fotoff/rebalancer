/**
 * Bookmarks for agent grants.
 *
 * The vault stores permissions in `permissions[agent][pairKey]` — a mapping, so
 * it cannot be enumerated on-chain without an indexer. We therefore remember
 * locally *which* (agent, from, to) tuples the user has touched, and read every
 * actual value (enabled, expiry, budget…) fresh from the chain.
 *
 * This list is a convenience index, never a source of truth: a grant made
 * outside this browser won't appear here, and a revoked grant still listed here
 * will correctly render as disabled once its on-chain state is read.
 */

export type GrantRef = {
  agent: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
};

const KEY = "rebalancer.agentGrants.v1";

function storageKey(vault: string) {
  return `${KEY}.${vault.toLowerCase()}`;
}

function same(a: GrantRef, b: GrantRef) {
  return (
    a.agent.toLowerCase() === b.agent.toLowerCase() &&
    a.from.toLowerCase() === b.from.toLowerCase() &&
    a.to.toLowerCase() === b.to.toLowerCase()
  );
}

export function loadGrantRefs(vault: string): GrantRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(vault));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is GrantRef =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as GrantRef).agent === "string" &&
        typeof (g as GrantRef).from === "string" &&
        typeof (g as GrantRef).to === "string"
    );
  } catch {
    return [];
  }
}

export function rememberGrantRef(vault: string, ref: GrantRef): GrantRef[] {
  const next = loadGrantRefs(vault);
  if (!next.some((g) => same(g, ref))) next.push(ref);
  try {
    window.localStorage.setItem(storageKey(vault), JSON.stringify(next));
  } catch {
    /* quota or private mode — the on-chain state is unaffected */
  }
  return next;
}

export function forgetGrantRef(vault: string, ref: GrantRef): GrantRef[] {
  const next = loadGrantRefs(vault).filter((g) => !same(g, ref));
  try {
    window.localStorage.setItem(storageKey(vault), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
