import { ethers, network } from "hardhat";

/**
 * Full deploy of the non-custodial Variant A on Base.
 *
 *   FORK=1 npx hardhat run scripts/deploy-noncustodial.ts          # dry-run on a Base fork
 *   npx hardhat run scripts/deploy-noncustodial.ts --network base  # real mainnet deploy
 *
 * Steps:
 *   1. Deploy RebalancerFactory (deployer is temporary owner).
 *   2. Whitelist DEX routers.
 *   3. Register + VALIDATE Chainlink USD feeds (skips any that are stale/missing).
 *   4. Sanity-check getMinOut for WETH->USDC.
 *   5. Deploy a TimelockController and hand the factory's ownership to it
 *      (no more instant admin changes — every setter is delayed & public).
 */

// ─── Base mainnet addresses ────────────────────────────
const ROUTERS = {
  lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
};

const TOKENS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH: "0x4200000000000000000000000000000000000006",
};

// Chainlink USD feeds on Base + per-token staleness window (heartbeats differ:
// ETH/USD updates within hours, USDC/USD has a ~24h heartbeat). Verify on docs.chain.link.
const FEEDS: Record<string, { feed: string; maxAge: number }> = {
  [TOKENS.WETH]: { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", maxAge: 3 * 3600 }, // ETH/USD
  [TOKENS.USDC]: { feed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", maxAge: 25 * 3600 }, // USDC/USD
};

const FEE_RATE = 15; // 0.15%
const MAX_SLIPPAGE_CEILING_BPS = 300; // users may set up to 3% per pair
const MAX_PRICE_AGE = 3600; // 1h oracle staleness window
const TIMELOCK_DELAY = 2 * 24 * 60 * 60; // 48h

const AGG_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const isFork = process.env.FORK === "1";
  const operator = process.env.EXECUTOR_ADDRESS ?? deployer.address;
  const feeCollector = process.env.FEE_COLLECTOR ?? deployer.address;

  console.log(`Network: ${network.name}  fork=${isFork}`);
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Operator:", operator);

  // 1. Factory
  const Factory = await ethers.getContractFactory("RebalancerFactory");
  const factory = await Factory.deploy(
    operator,
    feeCollector,
    FEE_RATE,
    MAX_SLIPPAGE_CEILING_BPS,
    MAX_PRICE_AGE
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("\nRebalancerFactory:", factoryAddr);

  // Reads right after deploy can hit a lagging RPC node — retry a few times.
  const retryRead = async <T>(fn: () => Promise<T>, label: string): Promise<T | null> => {
    for (let i = 0; i < 5; i++) {
      try {
        return await fn();
      } catch {
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    console.warn(`  (read "${label}" kept failing — RPC lag, continuing)`);
    return null;
  };

  console.log("UserVault impl:   ", await retryRead(() => factory.implementation(), "implementation"));

  // 2. Routers
  for (const [name, addr] of Object.entries(ROUTERS)) {
    await (await factory.setRouterAllowed(addr, true)).wait();
    console.log(`  router whitelisted: ${name} ${addr}`);
  }

  // 3. Feeds — validate each against chain state (price>0, fresh within maxAge) first.
  const goodTokens: string[] = [];
  for (const [token, { feed, maxAge }] of Object.entries(FEEDS)) {
    try {
      const agg = new ethers.Contract(feed, AGG_ABI, ethers.provider);
      const [, answer, , updatedAt] = await agg.latestRoundData();
      const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
      if (answer <= 0n) throw new Error("answer<=0");
      if (age > maxAge) throw new Error(`stale: age=${age}s > maxAge=${maxAge}s`);
      await (await factory.setPriceFeed(token, feed, maxAge)).wait();
      goodTokens.push(token);
      console.log(`  feed ok: ${token} -> ${feed}  price=${answer} age=${age}s maxAge=${maxAge}s`);
    } catch (e: any) {
      console.warn(`  feed SKIPPED: ${token} -> ${feed}  (${e.message})`);
    }
  }

  // 4. Sanity: 1 WETH -> USDC min-out (1% slippage)
  if (goodTokens.includes(TOKENS.WETH) && goodTokens.includes(TOKENS.USDC)) {
    const minOut = await retryRead(
      () => factory.getMinOut(TOKENS.WETH, TOKENS.USDC, ethers.parseEther("1"), 100),
      "getMinOut"
    );
    if (minOut != null) console.log(`\n  getMinOut(1 WETH -> USDC, 1%) = ${ethers.formatUnits(minOut, 6)} USDC`);
  }

  // 5. Timelock owns the factory
  const Timelock = await ethers.getContractFactory("TimelockController");
  // proposers/executors = [deployer] for now; swap to a multisig later.
  const timelock = await Timelock.deploy(TIMELOCK_DELAY, [deployer.address], [deployer.address], deployer.address);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  await (await factory.transferOwnership(timelockAddr)).wait();
  console.log(`\nTimelockController: ${timelockAddr}  delay=${TIMELOCK_DELAY}s`);
  console.log("Factory owner ->", await factory.owner());

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ factory: factoryAddr, timelock: timelockAddr, operator, supportedTokens: goodTokens }, null, 2));
  console.log("\nNext: set NEXT_PUBLIC_FACTORY_ADDRESS, point trigger-checker at the factory, verify on BaseScan.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
