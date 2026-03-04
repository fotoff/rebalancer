/**
 * A1: SQLite database layer (better-sqlite3)
 *
 * Single-file database in data/rebalancer.db.
 * Auto-creates tables on first import (migration).
 * Provides typed CRUD helpers for pairs, triggers, vault_history.
 */

import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";
import { log } from "./logger";

// ─── Database setup ──────────────────────────────────────
const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "rebalancer.db");

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

// Singleton connection
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL"); // better concurrency
  _db.pragma("busy_timeout = 5000"); // wait up to 5s if locked
  _db.pragma("foreign_keys = ON");

  runMigrations(_db);
  log.info("db", `SQLite opened: ${DB_PATH}`);
  return _db;
}

// ─── Migrations ──────────────────────────────────────────
function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pairs (
      id            TEXT PRIMARY KEY,
      user_address  TEXT NOT NULL,
      token1        TEXT NOT NULL,
      token2        TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pairs_user ON pairs(user_address);

    CREATE TABLE IF NOT EXISTS triggers (
      id              TEXT PRIMARY KEY,
      pair_id         TEXT NOT NULL,
      user_address    TEXT NOT NULL,
      direction       TEXT NOT NULL CHECK(direction IN ('1to2', '2to1')),
      metric          TEXT NOT NULL DEFAULT 'ratio' CHECK(metric IN ('price', 'ratio')),
      price_token     TEXT,
      type            TEXT NOT NULL CHECK(type IN ('gte', 'lte', 'eq')),
      value           REAL NOT NULL,
      from_token      TEXT NOT NULL,
      to_token        TEXT NOT NULL,
      auto_enabled    INTEGER NOT NULL DEFAULT 0,
      amount_mode     TEXT NOT NULL DEFAULT 'percent' CHECK(amount_mode IN ('percent', 'tokens')),
      amount          REAL NOT NULL DEFAULT 100,
      status          TEXT DEFAULT 'active' CHECK(status IN ('active', 'triggered', 'disabled')),
      last_triggered  TEXT,
      tx_hash         TEXT,
      auto_task_id    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_triggers_user ON triggers(user_address);
    CREATE INDEX IF NOT EXISTS idx_triggers_pair ON triggers(pair_id);
    CREATE INDEX IF NOT EXISTS idx_triggers_auto ON triggers(auto_enabled, status);

    CREATE TABLE IF NOT EXISTS vault_history (
      id            TEXT PRIMARY KEY,
      user_address  TEXT NOT NULL,
      pair_id       TEXT,
      type          TEXT NOT NULL CHECK(type IN ('deposit', 'withdraw', 'rebalance')),
      token         TEXT NOT NULL DEFAULT '',
      amount        TEXT NOT NULL DEFAULT '0',
      from_token    TEXT,
      to_token      TEXT,
      amount_in     TEXT,
      amount_out    TEXT,
      tx_hash       TEXT,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_vh_user ON vault_history(user_address);
    CREATE INDEX IF NOT EXISTS idx_vh_pair ON vault_history(pair_id);

    CREATE TABLE IF NOT EXISTS token_scam_cache (
      token_address  TEXT NOT NULL,
      chain_id       TEXT NOT NULL,
      is_scam        INTEGER NOT NULL CHECK(is_scam IN (0, 1)),
      checked_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (token_address, chain_id)
    );

    CREATE INDEX IF NOT EXISTS idx_scam_cache_chain ON token_scam_cache(chain_id);

    CREATE TABLE IF NOT EXISTS ai_recommendations (
      id              TEXT PRIMARY KEY,
      user_address    TEXT NOT NULL,
      pair_id         TEXT,
      chain_id        INTEGER NOT NULL DEFAULT 8453,
      action          TEXT NOT NULL CHECK(action IN ('HOLD', 'REBALANCE_NOW', 'SUGGEST_TRIGGERS')),
      json_payload    TEXT NOT NULL,
      model_version   TEXT NOT NULL DEFAULT 'mvp-heuristic',
      feature_version TEXT NOT NULL DEFAULT '1.0.0',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ai_rec_user ON ai_recommendations(user_address);
    CREATE INDEX IF NOT EXISTS idx_ai_rec_pair ON ai_recommendations(pair_id);

    CREATE TABLE IF NOT EXISTS ai_policy_violations (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id   TEXT NOT NULL,
      code                TEXT NOT NULL,
      severity            TEXT NOT NULL,
      actual              REAL,
      lim                 REAL,
      message             TEXT DEFAULT '',
      FOREIGN KEY (recommendation_id) REFERENCES ai_recommendations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_pv_rec ON ai_policy_violations(recommendation_id);
  `);
}

// ─── Types ───────────────────────────────────────────────
export interface DbPair {
  id: string;
  user_address: string;
  token1: string;
  token2: string;
  created_at: string;
}

export interface DbTrigger {
  id: string;
  pair_id: string;
  user_address: string;
  direction: "1to2" | "2to1";
  metric: "price" | "ratio";
  price_token: string | null;
  type: "gte" | "lte" | "eq";
  value: number;
  from_token: string;
  to_token: string;
  auto_enabled: number; // 0 | 1
  amount_mode: "percent" | "tokens";
  amount: number;
  status: string | null;
  last_triggered: string | null;
  tx_hash: string | null;
  auto_task_id: string | null;
}

export interface DbVaultEvent {
  id: string;
  user_address: string;
  pair_id: string | null;
  type: "deposit" | "withdraw" | "rebalance";
  token: string;
  amount: string;
  from_token: string | null;
  to_token: string | null;
  amount_in: string | null;
  amount_out: string | null;
  tx_hash: string | null;
  timestamp: string;
}

// ─── Pairs ───────────────────────────────────────────────
export const pairs = {
  getByUser(userAddress: string): DbPair[] {
    return getDb()
      .prepare("SELECT * FROM pairs WHERE user_address = ?")
      .all(userAddress) as DbPair[];
  },

  findDuplicate(
    userAddress: string,
    token1: string,
    token2: string
  ): DbPair | undefined {
    return getDb()
      .prepare(
        `SELECT * FROM pairs
         WHERE user_address = ?
           AND ((token1 = ? AND token2 = ?) OR (token1 = ? AND token2 = ?))
         LIMIT 1`
      )
      .get(userAddress, token1, token2, token2, token1) as DbPair | undefined;
  },

  create(pair: DbPair): DbPair {
    getDb()
      .prepare(
        "INSERT INTO pairs (id, user_address, token1, token2, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(pair.id, pair.user_address, pair.token1, pair.token2, pair.created_at);
    return pair;
  },

  getById(id: string): DbPair | undefined {
    return getDb()
      .prepare("SELECT * FROM pairs WHERE id = ?")
      .get(id) as DbPair | undefined;
  },

  delete(id: string): boolean {
    const result = getDb()
      .prepare("DELETE FROM pairs WHERE id = ?")
      .run(id);
    return result.changes > 0;
  },
};

// ─── Triggers ────────────────────────────────────────────

/** Convert a DB trigger row to the JSON shape the frontend expects */
function triggerToApi(t: DbTrigger) {
  return {
    id: t.id,
    pairId: t.pair_id,
    userAddress: t.user_address,
    direction: t.direction,
    metric: t.metric,
    priceToken: t.price_token ?? undefined,
    type: t.type,
    value: t.value,
    fromToken: t.from_token,
    toToken: t.to_token,
    autoEnabled: !!t.auto_enabled,
    amountMode: t.amount_mode,
    amount: t.amount,
    status: t.status ?? undefined,
    lastTriggered: t.last_triggered ?? undefined,
    txHash: t.tx_hash ?? undefined,
    autoTaskId: t.auto_task_id ?? undefined,
  };
}

export const triggers = {
  getByUser(userAddress: string, pairId?: string) {
    if (pairId) {
      const rows = getDb()
        .prepare(
          "SELECT * FROM triggers WHERE user_address = ? AND pair_id = ?"
        )
        .all(userAddress, pairId) as DbTrigger[];
      return rows.map(triggerToApi);
    }
    const rows = getDb()
      .prepare("SELECT * FROM triggers WHERE user_address = ?")
      .all(userAddress) as DbTrigger[];
    return rows.map(triggerToApi);
  },

  getAutoEnabled() {
    const rows = getDb()
      .prepare(
        "SELECT * FROM triggers WHERE auto_enabled = 1 AND status != 'disabled'"
      )
      .all() as DbTrigger[];
    return rows.map(triggerToApi);
  },

  getById(id: string): DbTrigger | undefined {
    return getDb()
      .prepare("SELECT * FROM triggers WHERE id = ?")
      .get(id) as DbTrigger | undefined;
  },

  create(t: {
    id: string;
    pairId: string;
    userAddress: string;
    direction: string;
    metric: string;
    priceToken?: string;
    type: string;
    value: number;
    fromToken: string;
    toToken: string;
    autoEnabled: boolean;
    amountMode: string;
    amount: number;
  }) {
    getDb()
      .prepare(
        `INSERT INTO triggers
         (id, pair_id, user_address, direction, metric, price_token, type, value,
          from_token, to_token, auto_enabled, amount_mode, amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        t.id,
        t.pairId,
        t.userAddress,
        t.direction,
        t.metric,
        t.priceToken ?? null,
        t.type,
        t.value,
        t.fromToken,
        t.toToken,
        t.autoEnabled ? 1 : 0,
        t.amountMode,
        t.amount
      );
    // Return the API shape
    const row = this.getById(t.id)!;
    return triggerToApi(row);
  },

  update(
    id: string,
    fields: {
      autoEnabled?: boolean;
      status?: string;
      lastTriggered?: string;
      txHash?: string;
      autoTaskId?: string;
    }
  ) {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (fields.autoEnabled !== undefined) {
      sets.push("auto_enabled = ?");
      vals.push(fields.autoEnabled ? 1 : 0);
    }
    if (fields.status !== undefined) {
      sets.push("status = ?");
      vals.push(fields.status);
    }
    if (fields.lastTriggered !== undefined) {
      sets.push("last_triggered = ?");
      vals.push(fields.lastTriggered);
    }
    if (fields.txHash !== undefined) {
      sets.push("tx_hash = ?");
      vals.push(fields.txHash);
    }
    if (fields.autoTaskId !== undefined) {
      sets.push("auto_task_id = ?");
      vals.push(fields.autoTaskId);
    }

    if (sets.length === 0) return null;

    vals.push(id);
    getDb()
      .prepare(`UPDATE triggers SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals);

    const row = this.getById(id);
    return row ? triggerToApi(row) : null;
  },

  delete(id: string): boolean {
    const result = getDb()
      .prepare("DELETE FROM triggers WHERE id = ?")
      .run(id);
    return result.changes > 0;
  },
};

// ─── Vault History ───────────────────────────────────────
export const vaultHistory = {
  getByUser(userAddress: string, pairId?: string): DbVaultEvent[] {
    if (pairId) {
      return getDb()
        .prepare(
          "SELECT * FROM vault_history WHERE user_address = ? AND pair_id = ? ORDER BY timestamp DESC"
        )
        .all(userAddress, pairId) as DbVaultEvent[];
    }
    return getDb()
      .prepare(
        "SELECT * FROM vault_history WHERE user_address = ? ORDER BY timestamp DESC"
      )
      .all(userAddress) as DbVaultEvent[];
  },

  /** Legacy filter: events without pair_id matching by token addresses */
  getByUserWithLegacyFilter(
    userAddress: string,
    pairId: string
  ): DbVaultEvent[] {
    const pairTokens = pairId.split("-");
    if (pairTokens.length !== 2) return [];
    const [pt1, pt2] = pairTokens;

    // Get events that have this pair_id OR match the legacy token filter
    const rows = getDb()
      .prepare(
        "SELECT * FROM vault_history WHERE user_address = ? ORDER BY timestamp DESC"
      )
      .all(userAddress) as DbVaultEvent[];

    return rows.filter((e) => {
      if (e.pair_id) return e.pair_id === pairId;
      // Legacy match by tokens
      if (e.type === "deposit" || e.type === "withdraw") {
        return e.token === pt1 || e.token === pt2;
      }
      if (e.type === "rebalance") {
        return (
          (e.from_token === pt1 && e.to_token === pt2) ||
          (e.from_token === pt2 && e.to_token === pt1)
        );
      }
      return false;
    });
  },

  create(event: DbVaultEvent): DbVaultEvent {
    getDb()
      .prepare(
        `INSERT INTO vault_history
         (id, user_address, pair_id, type, token, amount, from_token, to_token, amount_in, amount_out, tx_hash, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.user_address,
        event.pair_id,
        event.type,
        event.token,
        event.amount,
        event.from_token,
        event.to_token,
        event.amount_in,
        event.amount_out,
        event.tx_hash,
        event.timestamp
      );
    return event;
  },
};

// ─── Token Scam Cache ─────────────────────────────────────
export const tokenScamCache = {
  /** Get cached scam status for addresses. Returns Map: addr -> is_scam (true = scam) */
  getBatch(
    addresses: string[],
    chainId: string
  ): Map<string, boolean> {
    if (addresses.length === 0) return new Map();
    const db = getDb();
    const lower = addresses.map((a) => a.toLowerCase());
    const placeholders = lower.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT token_address, is_scam FROM token_scam_cache
         WHERE token_address IN (${placeholders}) AND chain_id = ?`
      )
      .all(...lower, chainId) as Array<{ token_address: string; is_scam: number }>;
    const out = new Map<string, boolean>();
    for (const r of rows) {
      out.set(r.token_address.toLowerCase(), r.is_scam === 1);
    }
    return out;
  },

  /** Upsert scam status for an address */
  upsert(tokenAddress: string, chainId: string, isScam: boolean): void {
    const addr = tokenAddress.toLowerCase();
    getDb()
      .prepare(
        `INSERT INTO token_scam_cache (token_address, chain_id, is_scam, checked_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(token_address, chain_id) DO UPDATE SET
           is_scam = excluded.is_scam,
           checked_at = datetime('now')`
      )
      .run(addr, chainId, isScam ? 1 : 0);
  },

  /** Upsert batch of results */
  upsertBatch(
    entries: Array<{ address: string; isScam: boolean }>,
    chainId: string
  ): void {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO token_scam_cache (token_address, chain_id, is_scam, checked_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(token_address, chain_id) DO UPDATE SET
         is_scam = excluded.is_scam,
         checked_at = datetime('now')`
    );
    for (const e of entries) {
      stmt.run(e.address.toLowerCase(), chainId, e.isScam ? 1 : 0);
    }
  },
};

// ─── AI Recommendations ─────────────────────────────────
export interface DbAiRecommendation {
  id: string;
  user_address: string;
  pair_id: string | null;
  chain_id: number;
  action: string;
  json_payload: string;
  model_version: string;
  feature_version: string;
  created_at: string;
}

export const aiRecommendations = {
  save(rec: {
    id: string;
    userAddress: string;
    pairId: string;
    chainId: number;
    action: string;
    jsonPayload: string;
    modelVersion: string;
    featureVersion: string;
  }): void {
    getDb()
      .prepare(
        `INSERT INTO ai_recommendations
         (id, user_address, pair_id, chain_id, action, json_payload, model_version, feature_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rec.id,
        rec.userAddress,
        rec.pairId,
        rec.chainId,
        rec.action,
        rec.jsonPayload,
        rec.modelVersion,
        rec.featureVersion
      );
  },

  getLatest(userAddress: string, pairId: string): DbAiRecommendation | undefined {
    return getDb()
      .prepare(
        `SELECT * FROM ai_recommendations
         WHERE user_address = ? AND pair_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(userAddress, pairId) as DbAiRecommendation | undefined;
  },

  getByUser(userAddress: string, limit = 20): DbAiRecommendation[] {
    return getDb()
      .prepare(
        `SELECT * FROM ai_recommendations
         WHERE user_address = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(userAddress, limit) as DbAiRecommendation[];
  },

  saveViolations(
    recommendationId: string,
    violations: Array<{
      code: string;
      severity: string;
      actual: number;
      limit: number;
      message: string;
    }>
  ): void {
    const stmt = getDb().prepare(
      `INSERT INTO ai_policy_violations
       (recommendation_id, code, severity, actual, lim, message)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const v of violations) {
      stmt.run(recommendationId, v.code, v.severity, v.actual, v.limit, v.message);
    }
  },
};

// ─── Health check ────────────────────────────────────────
export function dbHealthCheck(): { ok: boolean; tables: string[] } {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as { name: string }[];
    return { ok: true, tables: rows.map((r) => r.name) };
  } catch {
    return { ok: false, tables: [] };
  }
}
