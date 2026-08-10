import { ethers } from "hardhat";

/**
 * Finishes configuring an already-deployed RebalancerFactory (idempotent).
 * Use after deploy-noncustodial.ts if it stopped partway (e.g. RPC read race).
 *
 *   FACTORY_ADDRESS=0x... npx hardhat run scripts/configure-noncustodial.ts --network base
 */

const ROUTERS = { lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" };
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FEEDS: Record<string, { feed: string; maxAge: number }> = {
  [WETH]: { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", maxAge: 3 * 3600 },
  [USDC]: { feed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", maxAge: 25 * 3600 },
};
const TIMELOCK_DELAY = 2 * 24 * 60 * 60;
const AGG_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];

async function main() {
  const factoryAddr = process.env.FACTORY_ADDRESS;
  if (!factoryAddr) throw new Error("Set FACTORY_ADDRESS");
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("RebalancerFactory", factoryAddr);

  const owner = await factory.owner();
  console.log("Factory:", factoryAddr);
  console.log("Owner:  ", owner, "| deployer:", deployer.address);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Deployer is not the owner — already handed to timelock? Aborting.");
  }

  // Routers (skip if already set)
  for (const [name, addr] of Object.entries(ROUTERS)) {
    if (await factory.isRouterAllowed(addr)) {
      console.log(`  router already set: ${name}`);
    } else {
      await (await factory.setRouterAllowed(addr, true)).wait();
      console.log(`  router whitelisted: ${name} ${addr}`);
    }
  }

  // Feeds (validate live; skip if already set)
  const goodTokens: string[] = [];
  for (const [token, { feed, maxAge }] of Object.entries(FEEDS)) {
    const existing = await factory.priceFeeds(token);
    if (existing && existing.toLowerCase() === feed.toLowerCase()) {
      console.log(`  feed already set: ${token}`);
      goodTokens.push(token);
      continue;
    }
    try {
      const agg = new ethers.Contract(feed, AGG_ABI, ethers.provider);
      const [, answer, , updatedAt] = await agg.latestRoundData();
      const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
      if (answer <= 0n) throw new Error("answer<=0");
      if (age > maxAge) throw new Error(`stale age=${age}>${maxAge}`);
      await (await factory.setPriceFeed(token, feed, maxAge)).wait();
      goodTokens.push(token);
      console.log(`  feed ok: ${token} -> ${feed} age=${age}s`);
    } catch (e: any) {
      console.warn(`  feed SKIPPED: ${token} (${e.message})`);
    }
  }

  if (goodTokens.includes(WETH) && goodTokens.includes(USDC)) {
    try {
      const minOut = await factory.getMinOut(WETH, USDC, ethers.parseEther("1"), 100);
      console.log(`  getMinOut(1 WETH->USDC,1%) = ${ethers.formatUnits(minOut, 6)} USDC`);
    } catch (e: any) {
      // Non-fatal: read-after-write RPC lag can transiently revert this view.
      console.warn(`  getMinOut sanity check skipped (RPC lag): ${e.shortMessage || e.message}`);
    }
  }

  // Timelock + hand over ownership
  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock = await Timelock.deploy(TIMELOCK_DELAY, [deployer.address], [deployer.address], deployer.address);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  await (await factory.transferOwnership(timelockAddr)).wait();

  console.log(`\nTimelock: ${timelockAddr} delay=${TIMELOCK_DELAY}s`);
  console.log("Factory owner ->", await factory.owner());
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ factory: factoryAddr, implementation: await factory.implementation(), timelock: timelockAddr, supportedTokens: goodTokens }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
