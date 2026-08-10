/**
 * Self-hosted Trigger Checker — Non-custodial (Variant A)
 *
 * Differences vs checker.mjs (custodial):
 *  - Each user has their OWN vault, resolved via factory.vaultOf(user).
 *  - Balance is just the vault's ERC20 balanceOf(fromToken) (no shared ledger).
 *  - Executes vault.rebalance(from, to, amount, router, swapData). The minimum
 *    output is enforced ON-CHAIN by the factory's Chainlink oracle minus the
 *    user's per-pair slippage — we do NOT (and cannot) set it here.
 *  - If the user hasn't deployed a vault or hasn't allowed the pair, the call
 *    simply reverts/skips — by design.
 *
 * Requires: PRIVATE_KEY (executor), FACTORY_ADDRESS in environment.
 */

import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ─── Config ───────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL || "https://tokenrebalancer.com";
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
const LIFI_QUOTE_URL = "https://li.quest/v1/quote";
const BASE_CHAIN_ID = "8453";
const SLIPPAGE = "0.01"; // 1% (LI.FI route slippage; on-chain oracle bound is separate)
const CHECK_INTERVAL = 5 * 60 * 1000;
const ZERO = "0x0000000000000000000000000000000000000000";

// ─── ABIs ─────────────────────────────────────────────────
const FACTORY_ABI = parseAbi([
  "function vaultOf(address user) external view returns (address)",
]);
const VAULT_ABI = parseAbi([
  "function rebalance(address from, address to, uint256 amountIn, address router, bytes swapData, uint256 operatorMinOut) external returns (uint256)",
]);
const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
  "function balanceOf(address) external view returns (uint256)",
]);

const decimalsCache = new Map();
const MAX_EMPTY_FIRES = 5;
const emptyFireCount = new Map();

// ─── Setup ────────────────────────────────────────────────
if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY not set");
  process.exit(1);
}
if (!FACTORY_ADDRESS) {
  console.error("❌ FACTORY_ADDRESS not set");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) });

console.log("🔄 Trigger Checker (non-custodial) started");
console.log(`   Executor: ${account.address}`);
console.log(`   Factory:  ${FACTORY_ADDRESS}`);
console.log(`   API:      ${API_BASE_URL}`);
console.log(`   Interval: ${CHECK_INTERVAL / 1000}s\n`);

async function getDecimals(tokenAddress) {
  const addr = tokenAddress.toLowerCase();
  if (decimalsCache.has(addr)) return decimalsCache.get(addr);
  try {
    const dec = await publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "decimals" });
    decimalsCache.set(addr, Number(dec));
    return Number(dec);
  } catch {
    return 18;
  }
}

async function getLiFiQuote(vault, fromToken, toToken, fromAmount) {
  const params = new URLSearchParams({
    fromChain: BASE_CHAIN_ID,
    toChain: BASE_CHAIN_ID,
    fromToken,
    toToken,
    fromAmount: fromAmount.toString(),
    fromAddress: vault, // funds pulled from and returned to the user's vault
    toAddress: vault,
    slippage: SLIPPAGE,
    order: "CHEAPEST",
  });
  const resp = await fetch(`${LIFI_QUOTE_URL}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`LI.FI quote failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  if (!data.estimate || !data.transactionRequest) throw new Error("LI.FI returned no route");
  return {
    toAmount: BigInt(data.estimate.toAmount),
    toAmountMin: BigInt(data.estimate.toAmountMin),
    router: data.transactionRequest.to,
    swapData: data.transactionRequest.data,
    tool: data.tool || "unknown",
  };
}

async function resolveVault(user) {
  const vault = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "vaultOf",
    args: [user],
  });
  return vault && vault !== ZERO ? vault : null;
}

async function checkTriggers() {
  const ts = new Date().toISOString();
  console.log(`[${ts}] Checking triggers...`);

  let triggers;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/triggers?autoEnabled=true`, { headers: { "x-api-key": INTERNAL_API_KEY } });
    if (!resp.ok) return console.log(`  ⚠ API error: ${resp.status}`);
    triggers = await resp.json();
  } catch (err) {
    return console.log(`  ⚠ Failed to fetch triggers: ${err.message}`);
  }
  if (!triggers || triggers.length === 0) return console.log("  No active triggers");
  console.log(`  Found ${triggers.length} active trigger(s)`);

  // Prices
  const tokenAddresses = new Set();
  for (const t of triggers) {
    tokenAddresses.add(t.fromToken.toLowerCase());
    tokenAddresses.add(t.toToken.toLowerCase());
    if (t.priceToken) tokenAddresses.add(t.priceToken.toLowerCase());
  }
  const prices = {};
  try {
    const resp = await fetch(`https://api.dexscreener.com/tokens/v1/base/${[...tokenAddresses].join(",")}`);
    if (resp.ok) {
      for (const pair of await resp.json()) {
        const addr = pair.baseToken.address.toLowerCase();
        if (!prices[addr] && pair.priceUsd) prices[addr] = parseFloat(pair.priceUsd);
      }
    }
  } catch (err) {
    return console.log(`  ⚠ Failed to fetch prices: ${err.message}`);
  }

  for (const trigger of triggers) {
    const fromPrice = prices[trigger.fromToken.toLowerCase()] ?? 0;
    const toPrice = prices[trigger.toToken.toLowerCase()] ?? 0;
    if (fromPrice === 0 || toPrice === 0) continue;

    let currentValue;
    if (trigger.metric === "ratio") {
      const [t1, t2] = trigger.pairId.split("-");
      currentValue = (prices[t2] ?? 0) > 0 ? (prices[t1] ?? 0) / (prices[t2] ?? 0) : 0;
    } else {
      currentValue = prices[trigger.priceToken?.toLowerCase() ?? trigger.fromToken.toLowerCase()] ?? 0;
    }
    if (currentValue === 0) continue;

    let fired = false;
    if (trigger.type === "gte" && currentValue >= trigger.value) fired = true;
    if (trigger.type === "lte" && currentValue <= trigger.value) fired = true;
    if (trigger.type === "eq" && Math.abs(currentValue - trigger.value) / trigger.value < 0.005) fired = true;
    if (!fired) continue;

    console.log(`  🔥 Trigger ${trigger.id} FIRED (${trigger.metric} ${trigger.type} ${trigger.value}, current ${currentValue.toFixed(6)})`);

    // Resolve the user's personal vault
    let vault;
    try {
      vault = await resolveVault(trigger.userAddress);
    } catch (err) {
      console.log(`  ⚠ vaultOf failed: ${err.message}`);
      continue;
    }
    if (!vault) {
      console.log(`  ⏭ ${trigger.userAddress} has no vault — skipping`);
      continue;
    }

    // Vault balance of fromToken
    let vaultBalance;
    try {
      vaultBalance = await publicClient.readContract({
        address: trigger.fromToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [vault],
      });
    } catch (err) {
      console.log(`  ⚠ balanceOf failed: ${err.message}`);
      continue;
    }

    if (vaultBalance === 0n) {
      const count = (emptyFireCount.get(trigger.id) ?? 0) + 1;
      emptyFireCount.set(trigger.id, count);
      console.log(`  ⚠ Vault empty, skipping (${count}/${MAX_EMPTY_FIRES})`);
      if (count >= MAX_EMPTY_FIRES) {
        emptyFireCount.delete(trigger.id);
        await fetch(`${API_BASE_URL}/api/triggers`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-api-key": INTERNAL_API_KEY },
          body: JSON.stringify({ id: trigger.id, autoEnabled: false, status: "disabled" }),
        }).catch(() => {});
      }
      continue;
    }
    emptyFireCount.delete(trigger.id);

    // Amount
    let amountIn;
    if (trigger.amountMode === "percent") {
      amountIn = (vaultBalance * BigInt(Math.round(trigger.amount ?? 100))) / 100n;
    } else if (trigger.amountMode === "tokens" && trigger.amount) {
      const dec = await getDecimals(trigger.fromToken);
      amountIn = BigInt(Math.floor(trigger.amount * 10 ** dec));
      if (amountIn > vaultBalance) amountIn = vaultBalance;
    } else {
      amountIn = vaultBalance;
    }
    if (amountIn === 0n) continue;

    // LI.FI quote (receiver = vault)
    let quote;
    try {
      quote = await getLiFiQuote(vault, trigger.fromToken, trigger.toToken, amountIn);
      console.log(`  📊 LI.FI via ${quote.tool}: ${amountIn} → ~${quote.toAmount} (router ${quote.router})`);
    } catch (err) {
      console.log(`  ⚠ LI.FI quote failed: ${err.message}`);
      continue;
    }

    // Execute rebalance on the user's vault
    console.log(`  📤 rebalance on ${vault}: ${amountIn} ${trigger.fromToken} → ${trigger.toToken}`);
    let txHash;
    try {
      const calldata = encodeFunctionData({
        abi: VAULT_ABI,
        functionName: "rebalance",
        // operatorMinOut = LI.FI's quoted min. Ignored for oracle pairs (the contract
        // enforces the stricter oracle floor); used for trusted oracle-less pairs.
        args: [trigger.fromToken, trigger.toToken, amountIn, quote.router, quote.swapData, quote.toAmountMin],
      });
      let gas;
      try {
        gas = ((await publicClient.estimateGas({ account: account.address, to: vault, data: calldata })) * 120n) / 100n;
      } catch (err) {
        console.log(`  ⚠ gas estimate failed (likely policy/oracle revert): ${err.shortMessage || err.message}`);
        continue; // if it would revert, don't blind-send
      }
      txHash = await walletClient.sendTransaction({ to: vault, data: calldata, gas });
      console.log(`  ✅ TX sent: ${txHash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      console.log(`  ✅ Confirmed in block ${receipt.blockNumber} (status ${receipt.status})`);
    } catch (err) {
      console.log(`  ❌ TX failed: ${err.shortMessage || err.message}`);
      continue;
    }

    // Mark triggered
    await fetch(`${API_BASE_URL}/api/triggers`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-api-key": INTERNAL_API_KEY },
      body: JSON.stringify({ id: trigger.id, status: "triggered", autoEnabled: false, lastTriggered: new Date().toISOString(), txHash }),
    }).catch((err) => console.log(`  ⚠ PATCH error: ${err.message}`));

    // History
    await fetch(`${API_BASE_URL}/api/vault/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": INTERNAL_API_KEY },
      body: JSON.stringify({
        userAddress: trigger.userAddress,
        pairId: trigger.pairId,
        type: "rebalance",
        fromToken: trigger.fromToken,
        toToken: trigger.toToken,
        amountIn: amountIn.toString(),
        amountOut: quote.toAmountMin.toString(),
        txHash,
      }),
    }).catch((err) => console.log(`  ⚠ History error: ${err.message}`));
  }

  console.log(`[${new Date().toISOString()}] Check complete\n`);
}

checkTriggers().catch(console.error);
setInterval(() => checkTriggers().catch(console.error), CHECK_INTERVAL);
process.on("SIGINT", () => {
  console.log("\n🛑 Stopped");
  process.exit(0);
});
