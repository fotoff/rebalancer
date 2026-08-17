#!/usr/bin/env node
/**
 * Reference autonomous rebalancing agent for Base.
 *
 * The whole point of this file is that it holds no funds. It trades out of a
 * vault someone else owns, inside limits they set, and the chain rejects it if
 * it steps outside them. It cannot withdraw, and it cannot beat the oracle
 * floor. So the interesting logic here is deciding *whether* to trade.
 *
 * Each cycle:
 *   1. canTrade()  — ask the vault whether we're allowed right now, and why not
 *   2. signal      — buy a rebalancing decision (x402, $0.01) or read the free one
 *   3. quote       — ask LI.FI for a route, with the VAULT as sender and recipient
 *   4. agentTrade()— submit; the vault enforces the oracle floor over our min-out
 *
 * Safety: nothing is broadcast unless --execute is passed. Without it the agent
 * runs the full decision path and prints the transaction it *would* send.
 *
 *   node agent.mjs --once            # one dry cycle, free signal, no broadcast
 *   node agent.mjs --once --force    # ignore the signal (testing/demo only)
 *   node agent.mjs --once --pay      # same, but actually pay $0.01 over x402
 *   node agent.mjs --execute         # live: real trades, on a loop
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  formatUnits,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Node does not read .env on its own. loadEnvFile lands in 20.12; on anything
// older the operator can still export the variables or use --env-file.
try {
  process.loadEnvFile(new URL(".env", import.meta.url).pathname);
} catch {
  /* no .env, or a Node too old — fall through to the env check below */
}

// ─── Flags ────────────────────────────────────────────────
const argv = new Set(process.argv.slice(2));
const EXECUTE = argv.has("--execute");
const ONCE = argv.has("--once");
const PAY_FOR_SIGNAL = argv.has("--pay");
// Override the signal gate. The chain still enforces every limit — this only
// skips *our* opinion about whether the trade is worth making.
const FORCE = argv.has("--force");

// ─── Config ───────────────────────────────────────────────
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const VAULT = process.env.AGENT_VAULT_ADDRESS;
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const API = process.env.REBALANCER_API || "https://tokenrebalancer.com";
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 15 * 60 * 1000);

// The pair this agent is authorised for, and how much of `from` to move.
const FROM = process.env.FROM_TOKEN || "0x4200000000000000000000000000000000000006"; // WETH
const TO = process.env.TO_TOKEN || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC
const TRADE_FRACTION = Number(process.env.TRADE_FRACTION || 0.25); // of vault balance
const MIN_TRADE_USD = Number(process.env.MIN_TRADE_USD || 0.5);

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SIGNAL_PRICE = 10_000n; // $0.01, 6 decimals

const LIFI_QUOTE_URL = "https://li.quest/v1/quote";
const SLIPPAGE = 0.01; // 1%, matching the grant the UI issues

// Minimal ABI — only what the agent actually calls.
const VAULT_ABI = [
  {
    type: "function",
    name: "canTrade",
    stateMutability: "view",
    inputs: [
      { name: "agent", type: "address" },
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "allowed", type: "bool" },
      { name: "reason", type: "string" },
    ],
  },
  {
    type: "function",
    name: "remainingBudget",
    stateMutability: "view",
    inputs: [
      { name: "agent", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "agentTrade",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "router", type: "address" },
      { name: "swapData", type: "bytes" },
      { name: "agentMinOut", type: "uint256" },
    ],
    outputs: [{ name: "received", type: "uint256" }],
  },
];

function requireEnv() {
  const missing = [];
  if (!VAULT) missing.push("AGENT_VAULT_ADDRESS");
  if (!PRIVATE_KEY) missing.push("AGENT_PRIVATE_KEY");
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}. See .env.example.`);
    process.exit(1);
  }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ─── Signal ───────────────────────────────────────────────

/**
 * Buy a rebalancing decision. With --pay this goes through x402: the endpoint
 * answers 402, x402-fetch settles $0.01 USDC on Base, and the retry returns the
 * signal. Without it we read the same analysis from the unpaywalled route, so a
 * dry run costs nothing.
 */
async function getSignal(account, publicClient) {
  const body = JSON.stringify({ tokenA: FROM, tokenB: TO });
  const headers = { "content-type": "application/json" };

  // Check we can actually afford the call. Without this the agent signs an
  // authorisation it cannot cover, the facilitator rejects it as an invalid
  // payload, and every cycle fails with an error that says nothing about the
  // real cause — an empty wallet.
  let payable = PAY_FOR_SIGNAL;
  if (PAY_FOR_SIGNAL) {
    const usdc = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (usdc < SIGNAL_PRICE) {
      log(
        `only ${formatUnits(usdc, 6)} USDC left, need 0.01 — falling back to the free signal`
      );
      payable = false;
    }
  }

  if (!payable) {
    const res = await fetch(`${API}/api/ai/analyze-pair`, {
      method: "POST",
      headers,
      body,
    });
    if (!res.ok) throw new Error(`free signal failed: HTTP ${res.status}`);
    return { paid: false, data: await res.json() };
  }

  // x402-fetch wants a signer, not a bare account: paying means signing an
  // EIP-3009 authorisation, which a wallet client exposes and an account does not.
  const { wrapFetchWithPayment, createSigner } = await import("x402-fetch");
  const signer = await createSigner("base", PRIVATE_KEY);
  const payFetch = wrapFetchWithPayment(fetch, signer);
  const res = await payFetch(`${API}/api/x402/signal`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `paid signal failed: HTTP ${res.status} ${detail.slice(0, 160)}`
    );
  }
  return { paid: true, data: await res.json() };
}

/**
 * Reduce whatever the signal endpoint returned to a yes/no. The paid endpoint
 * answers with an explicit `action`; the free analysis route reports statistics
 * and a backtest verdict, so we require it to actually favour rebalancing.
 */
function decide(signal) {
  if (typeof signal.action === "string") {
    return {
      trade: signal.action === "REBALANCE_NOW",
      why: `action=${signal.action}${signal.regime ? ` regime=${signal.regime}` : ""}`,
    };
  }
  const verdict = signal.backtest?.verdict ?? signal.verdict;
  const z = signal.stats?.spread_zscore ?? signal.spread_zscore;
  const beats = verdict === "BEATS_HODL";
  const stretched = typeof z === "number" && Math.abs(z) >= 1.5;
  return {
    trade: beats && stretched,
    why: `verdict=${verdict ?? "?"} z=${typeof z === "number" ? z.toFixed(2) : "?"}`,
  };
}

// ─── Quote ────────────────────────────────────────────────

/** LI.FI route. Sender and recipient are the VAULT — never the agent. */
async function getQuote(amountIn) {
  const params = new URLSearchParams({
    fromChain: "8453",
    toChain: "8453",
    fromToken: FROM,
    toToken: TO,
    fromAmount: amountIn.toString(),
    fromAddress: VAULT,
    toAddress: VAULT,
    slippage: String(SLIPPAGE),
    order: "CHEAPEST",
  });
  const res = await fetch(`${LIFI_QUOTE_URL}?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`LI.FI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const d = await res.json();
  if (!d.estimate || !d.transactionRequest) throw new Error("no route");
  return {
    toAmount: BigInt(d.estimate.toAmount),
    toAmountMin: BigInt(d.estimate.toAmountMin),
    router: d.transactionRequest.to,
    swapData: d.transactionRequest.data,
    tool: d.tool || "unknown",
  };
}

// ─── One cycle ────────────────────────────────────────────

async function cycle(publicClient, walletClient, account) {
  // How much are we willing to move? A fraction of what the vault holds.
  const [balance, decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: FROM,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [VAULT],
    }),
    publicClient.readContract({
      address: FROM,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: FROM,
      abi: erc20Abi,
      functionName: "symbol",
    }),
  ]);

  if (balance === 0n) {
    log(`vault holds no ${symbol} — nothing to rebalance`);
    return;
  }

  const amountIn =
    (balance * BigInt(Math.round(TRADE_FRACTION * 10_000))) / 10_000n;
  const human = formatUnits(amountIn, decimals);
  log(`vault ${symbol} balance ${formatUnits(balance, decimals)}, trading ${human}`);

  // 1. Ask the vault first — cheaper than a reverted transaction.
  const [allowed, reason] = await publicClient.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "canTrade",
    args: [account.address, FROM, TO, amountIn],
  });
  if (!allowed) {
    log(`vault says no: ${reason}`);
    return;
  }
  log("canTrade: allowed");

  // 2. Decide.
  const { paid, data } = await getSignal(account, publicClient);
  const { trade, why } = decide(data);
  log(`signal (${paid ? "paid $0.01 via x402" : "free"}): ${why}`);
  if (!trade && !FORCE) {
    log("holding — signal does not favour rebalancing");
    return;
  }
  if (!trade && FORCE) {
    log("--force: trading against the signal (testing only)");
  }

  // 3. Route.
  const quote = await getQuote(amountIn);
  log(
    `route via ${quote.tool}: ${human} ${symbol} -> ~${quote.toAmount} (min ${quote.toAmountMin})`
  );

  // 4. Trade. The vault raises our min-out to the oracle floor if it is higher.
  if (!EXECUTE) {
    log("DRY RUN — would call agentTrade(); pass --execute to broadcast");
    return;
  }

  const hash = await walletClient.writeContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "agentTrade",
    args: [FROM, TO, amountIn, quote.router, quote.swapData, quote.toAmountMin],
  });
  log(`submitted ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`${receipt.status} in block ${receipt.blockNumber}`);
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  requireEnv();

  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

  log(`agent ${account.address}`);
  log(`vault ${VAULT}`);
  log(EXECUTE ? "MODE: live — trades will be broadcast" : "MODE: dry run");

  const run = async () => {
    try {
      await cycle(publicClient, walletClient, account);
    } catch (e) {
      log(`cycle failed: ${e.message}`);
    }
  };

  await run();
  if (ONCE) return;

  log(`looping every ${Math.round(INTERVAL_MS / 1000)}s`);
  setInterval(run, INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
