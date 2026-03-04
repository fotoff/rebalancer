/**
 * Self-hosted Trigger Checker — Rebalancer V2
 *
 * Runs every 5 minutes via pm2 (setInterval).
 * 1. Fetches active triggers from the API
 * 2. Fetches current prices from DexScreener
 * 3. Checks trigger conditions
 * 4. If triggered — gets LI.FI quote and calls executeRebalance on the vault
 *
 * Requires: PRIVATE_KEY in environment (executor wallet)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ─── Config ───────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL || "https://tokenrebalancer.com";
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
const LIFI_QUOTE_URL = "https://li.quest/v1/quote";
const BASE_CHAIN_ID = "8453";
const SLIPPAGE = "0.01"; // 1%
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ─── ABIs ─────────────────────────────────────────────────
const VAULT_ABI = parseAbi([
  "function executeRebalance(address user, address fromToken, address toToken, uint256 amount, address swapTarget, bytes swapCalldata, uint256 amountOutMin) external returns (uint256)",
  "function balances(address user, address token) external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
]);

// ─── Decimals cache ──────────────────────────────────────
const decimalsCache = new Map();

// ─── Empty vault fire counter (auto-disable after N empty fires) ──
const MAX_EMPTY_FIRES = 5;
const emptyFireCount = new Map(); // triggerId → count

// ─── Setup ────────────────────────────────────────────────
if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY not set in environment");
  process.exit(1);
}

if (!VAULT_ADDRESS) {
  console.error("❌ VAULT_ADDRESS not set in environment");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(RPC_URL),
});

console.log(`🔄 Trigger Checker V2 started (LI.FI)`);
console.log(`   Executor: ${account.address}`);
console.log(`   Vault:    ${VAULT_ADDRESS}`);
console.log(`   API:      ${API_BASE_URL}`);
console.log(`   API Key:  ${INTERNAL_API_KEY ? "configured" : "⚠ NOT SET"}`);
console.log(`   Interval: ${CHECK_INTERVAL / 1000}s`);
console.log("");

// ─── Get token decimals (cached) ─────────────────────────
async function getDecimals(tokenAddress) {
  const addr = tokenAddress.toLowerCase();
  if (decimalsCache.has(addr)) return decimalsCache.get(addr);
  try {
    const dec = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    decimalsCache.set(addr, Number(dec));
    return Number(dec);
  } catch (err) {
    console.log(`  ⚠ Failed to read decimals for ${tokenAddress}, defaulting to 18: ${err.message}`);
    return 18;
  }
}

// ─── LI.FI Quote ─────────────────────────────────────────
async function getLiFiQuote(fromToken, toToken, fromAmount) {
  const params = new URLSearchParams({
    fromChain: BASE_CHAIN_ID,
    toChain: BASE_CHAIN_ID,
    fromToken,
    toToken,
    fromAmount: fromAmount.toString(),
    fromAddress: VAULT_ADDRESS,
    toAddress: VAULT_ADDRESS,
    slippage: SLIPPAGE,
    order: "CHEAPEST",
  });

  const resp = await fetch(`${LIFI_QUOTE_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LI.FI quote failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();

  if (!data.estimate || !data.transactionRequest) {
    throw new Error("LI.FI returned no route");
  }

  return {
    toAmount: BigInt(data.estimate.toAmount),
    toAmountMin: BigInt(data.estimate.toAmountMin),
    swapTarget: data.transactionRequest.to,
    swapCalldata: data.transactionRequest.data,
    tool: data.tool || "unknown",
  };
}

// ─── Main check function ──────────────────────────────────
async function checkTriggers() {
  const ts = new Date().toISOString();
  console.log(`[${ts}] Checking triggers...`);

  // 1. Fetch active triggers (S4: requires API key)
  let triggers;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/triggers?autoEnabled=true`, {
      headers: {
        "x-api-key": INTERNAL_API_KEY,
      },
    });
    if (!resp.ok) {
      console.log(`  ⚠ API error: ${resp.status}`);
      return;
    }
    triggers = await resp.json();
  } catch (err) {
    console.log(`  ⚠ Failed to fetch triggers: ${err.message}`);
    return;
  }

  if (!triggers || triggers.length === 0) {
    console.log("  No active triggers");
    return;
  }

  console.log(`  Found ${triggers.length} active trigger(s)`);

  // 2. Collect token addresses and fetch prices
  const tokenAddresses = new Set();
  for (const t of triggers) {
    tokenAddresses.add(t.fromToken.toLowerCase());
    tokenAddresses.add(t.toToken.toLowerCase());
    if (t.priceToken) tokenAddresses.add(t.priceToken.toLowerCase());
  }

  const addrList = [...tokenAddresses].join(",");
  const prices = {};
  try {
    const resp = await fetch(`https://api.dexscreener.com/tokens/v1/base/${addrList}`);
    if (resp.ok) {
      const pairs = await resp.json();
      for (const pair of pairs) {
        const addr = pair.baseToken.address.toLowerCase();
        if (!prices[addr] && pair.priceUsd) {
          prices[addr] = parseFloat(pair.priceUsd);
        }
      }
    }
  } catch (err) {
    console.log(`  ⚠ Failed to fetch prices: ${err.message}`);
    return;
  }

  // 3. Check each trigger
  for (const trigger of triggers) {
    const fromPrice = prices[trigger.fromToken.toLowerCase()] ?? 0;
    const toPrice = prices[trigger.toToken.toLowerCase()] ?? 0;

    if (fromPrice === 0 || toPrice === 0) continue;

    let currentValue;
    if (trigger.metric === "ratio") {
      const [t1, t2] = trigger.pairId.split("-");
      const p1 = prices[t1] ?? 0;
      const p2 = prices[t2] ?? 0;
      currentValue = p2 > 0 ? p1 / p2 : 0;
    } else {
      const tokenAddr = trigger.priceToken?.toLowerCase() ?? trigger.fromToken.toLowerCase();
      currentValue = prices[tokenAddr] ?? 0;
    }

    if (currentValue === 0) continue;

    // Check condition
    let fired = false;
    if (trigger.type === "gte" && currentValue >= trigger.value) fired = true;
    if (trigger.type === "lte" && currentValue <= trigger.value) fired = true;
    if (trigger.type === "eq" && Math.abs(currentValue - trigger.value) / trigger.value < 0.005) fired = true;

    if (!fired) continue;

    console.log(`  🔥 Trigger ${trigger.id} FIRED! (${trigger.metric} ${trigger.type} ${trigger.value}, current: ${currentValue.toFixed(6)})`);

    // 4. Get vault balance
    let vaultBalance;
    try {
      vaultBalance = await publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "balances",
        args: [trigger.userAddress, trigger.fromToken],
      });
    } catch (err) {
      console.log(`  ⚠ Failed to read vault balance: ${err.message}`);
      continue;
    }

    if (vaultBalance === 0n) {
      const count = (emptyFireCount.get(trigger.id) ?? 0) + 1;
      emptyFireCount.set(trigger.id, count);
      console.log(`  ⚠ Vault balance is 0, skipping (${count}/${MAX_EMPTY_FIRES})`);

      if (count >= MAX_EMPTY_FIRES) {
        console.log(`  🛑 Trigger ${trigger.id} auto-disabled after ${MAX_EMPTY_FIRES} empty fires`);
        emptyFireCount.delete(trigger.id);
        try {
          await fetch(`${API_BASE_URL}/api/triggers`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": INTERNAL_API_KEY,
            },
            body: JSON.stringify({
              id: trigger.id,
              autoEnabled: false,
              status: "disabled",
            }),
          });
        } catch (err) {
          console.log(`  ⚠ Failed to disable trigger: ${err.message}`);
        }
      }
      continue;
    }

    // Reset empty fire counter on successful vault balance read
    emptyFireCount.delete(trigger.id);

    // Compute amount (S5: dynamic decimals instead of hardcoded 1e18)
    let amountIn;
    if (trigger.amountMode === "percent") {
      const pct = BigInt(Math.round(trigger.amount ?? 100));
      amountIn = (vaultBalance * pct) / 100n;
    } else if (trigger.amountMode === "tokens" && trigger.amount) {
      const dec = await getDecimals(trigger.fromToken);
      amountIn = BigInt(Math.floor(trigger.amount * 10 ** dec));
      if (amountIn > vaultBalance) amountIn = vaultBalance;
    } else {
      amountIn = vaultBalance;
    }

    if (amountIn === 0n) continue;

    // 5. Get LI.FI quote
    let quote;
    try {
      quote = await getLiFiQuote(trigger.fromToken, trigger.toToken, amountIn);
      console.log(`  📊 LI.FI quote via ${quote.tool}: ${amountIn} → ~${quote.toAmount} (min: ${quote.toAmountMin})`);
    } catch (err) {
      console.log(`  ⚠ LI.FI quote failed: ${err.message}`);
      continue;
    }

    // 6. Execute rebalance on-chain
    console.log(`  📤 Executing rebalance via ${quote.tool}: ${amountIn} ${trigger.fromToken} → ${trigger.toToken}`);
    let txHash;
    try {
      const { encodeFunctionData } = await import("viem");

      // Encode the function call manually
      const calldata = encodeFunctionData({
        abi: VAULT_ABI,
        functionName: "executeRebalance",
        args: [
          trigger.userAddress,
          trigger.fromToken,
          trigger.toToken,
          amountIn,
          quote.swapTarget,
          quote.swapCalldata,
          quote.toAmountMin,
        ],
      });

      // S9: Estimate gas instead of hardcoded value
      let gasEstimate;
      try {
        gasEstimate = await publicClient.estimateGas({
          account: account.address,
          to: VAULT_ADDRESS,
          data: calldata,
        });
        // Add 20% buffer for safety
        gasEstimate = (gasEstimate * 120n) / 100n;
        console.log(`  ⛽ Estimated gas: ${gasEstimate}`);
      } catch (err) {
        console.log(`  ⚠ Gas estimation failed, using fallback 1.5M: ${err.shortMessage || err.message}`);
        gasEstimate = 1_500_000n;
      }

      // Send raw transaction with estimated gas
      txHash = await walletClient.sendTransaction({
        to: VAULT_ADDRESS,
        data: calldata,
        gas: gasEstimate,
      });

      console.log(`  ✅ TX sent: ${txHash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      console.log(`  ✅ TX confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);
    } catch (err) {
      const msg = err.shortMessage || err.message || String(err);
      console.log(`  ❌ TX failed: ${msg}`);
      if (err.cause?.shortMessage) console.log(`     Cause: ${err.cause.shortMessage}`);
      if (err.cause?.cause?.message) console.log(`     Root: ${err.cause.cause.message.slice(0, 200)}`);
      continue;
    }

    // 7. Mark trigger as triggered + disable auto-mode (one-shot)
    try {
      const patchResp = await fetch(`${API_BASE_URL}/api/triggers`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          id: trigger.id,
          status: "triggered",
          autoEnabled: false,
          lastTriggered: new Date().toISOString(),
          txHash: txHash,
        }),
      });
      if (patchResp.ok) {
        console.log("  📝 Trigger marked as triggered & auto-mode disabled");
      } else {
        console.log(`  ⚠ PATCH failed: ${patchResp.status} ${await patchResp.text()}`);
      }
    } catch (err) {
      console.log(`  ⚠ PATCH error: ${err.message}`);
    }

    // 8. Save rebalance to vault history (include pairId for pair-scoped stats)
    try {
      await fetch(`${API_BASE_URL}/api/vault/history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          userAddress: trigger.userAddress,
          pairId: trigger.pairId,
          type: "rebalance",
          fromToken: trigger.fromToken,
          toToken: trigger.toToken,
          amountIn: amountIn.toString(),
          amountOut: quote.toAmountMin.toString(),
          txHash: txHash,
        }),
      });
      console.log("  📝 Rebalance saved to vault history");
    } catch (err) {
      console.log(`  ⚠ History save error: ${err.message}`);
    }
  }

  console.log(`[${new Date().toISOString()}] Check complete\n`);
}

// ─── Run loop ─────────────────────────────────────────────
// Run immediately on start
checkTriggers().catch(console.error);

// Then every 5 minutes
setInterval(() => {
  checkTriggers().catch(console.error);
}, CHECK_INTERVAL);

// Keep alive
process.on("SIGINT", () => {
  console.log("\n🛑 Trigger Checker stopped");
  process.exit(0);
});
