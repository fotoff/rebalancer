/**
 * Migration script: JSON files → SQLite
 *
 * Reads pairs.json, triggers.json, vault-history.json from data/
 * and inserts all records into rebalancer.db.
 *
 * Safe to run multiple times — uses INSERT OR IGNORE.
 *
 * Usage: node scripts/migrate-json-to-sqlite.mjs
 */

import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "rebalancer.db");

// Ensure data dir exists
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create tables (same as db.ts migrations)
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
`);

function readJson(filename) {
  try {
    const raw = readFileSync(join(DATA_DIR, filename), "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.log(`  ⚠ Could not read ${filename}: ${err.message}`);
    return [];
  }
}

// ─── Migrate pairs ───────────────────────────────────────
console.log("📦 Migrating pairs.json...");
const pairsData = readJson("pairs.json");
const insertPair = db.prepare(
  "INSERT OR IGNORE INTO pairs (id, user_address, token1, token2, created_at) VALUES (?, ?, ?, ?, ?)"
);
let pairsCount = 0;
for (const p of pairsData) {
  insertPair.run(
    p.id,
    (p.userAddress || "").toLowerCase(),
    (p.token1 || "").toLowerCase(),
    (p.token2 || "").toLowerCase(),
    p.createdAt || new Date().toISOString()
  );
  pairsCount++;
}
console.log(`  ✅ ${pairsCount} pairs migrated`);

// ─── Migrate triggers ────────────────────────────────────
console.log("📦 Migrating triggers.json...");
const triggersData = readJson("triggers.json");
const insertTrigger = db.prepare(
  `INSERT OR IGNORE INTO triggers
   (id, pair_id, user_address, direction, metric, price_token, type, value,
    from_token, to_token, auto_enabled, amount_mode, amount, status,
    last_triggered, tx_hash, auto_task_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
let triggersCount = 0;
for (const t of triggersData) {
  insertTrigger.run(
    t.id,
    t.pairId || "",
    (t.userAddress || "").toLowerCase(),
    t.direction || "1to2",
    t.metric || "ratio",
    t.priceToken ? t.priceToken.toLowerCase() : null,
    t.type || "gte",
    t.value ?? 0,
    (t.fromToken || "").toLowerCase(),
    (t.toToken || "").toLowerCase(),
    t.autoEnabled ? 1 : 0,
    t.amountMode || "percent",
    t.amount ?? 100,
    t.status || "active",
    t.lastTriggered || null,
    t.txHash || null,
    t.gelatoTaskId || t.autoTaskId || null
  );
  triggersCount++;
}
console.log(`  ✅ ${triggersCount} triggers migrated`);

// ─── Migrate vault history ───────────────────────────────
console.log("📦 Migrating vault-history.json...");
const historyData = readJson("vault-history.json");
const insertHistory = db.prepare(
  `INSERT OR IGNORE INTO vault_history
   (id, user_address, pair_id, type, token, amount, from_token, to_token, amount_in, amount_out, tx_hash, timestamp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
let historyCount = 0;
for (const e of historyData) {
  insertHistory.run(
    e.id,
    (e.userAddress || "").toLowerCase(),
    e.pairId ? e.pairId.toLowerCase() : null,
    e.type,
    (e.token || "").toLowerCase(),
    e.amount || "0",
    e.fromToken ? e.fromToken.toLowerCase() : null,
    e.toToken ? e.toToken.toLowerCase() : null,
    e.amountIn || null,
    e.amountOut || null,
    e.txHash || null,
    e.timestamp || new Date().toISOString()
  );
  historyCount++;
}
console.log(`  ✅ ${historyCount} vault history events migrated`);

// ─── Summary ─────────────────────────────────────────────
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
console.log(`\n✅ Migration complete!`);
console.log(`   Database: ${DB_PATH}`);
console.log(`   Tables: ${tables.map(t => t.name).join(", ")}`);

// Verify counts
for (const table of tables) {
  const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM ${table.name}`).get();
  console.log(`   ${table.name}: ${cnt} rows`);
}

db.close();
