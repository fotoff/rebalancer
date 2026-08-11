import { ethers, network } from "hardhat";

/**
 * Deploy the AgentVault layer on Base — runs in PARALLEL with the existing
 * non-custodial stack. It does NOT touch RebalancerFactory or any UserVault;
 * it only reads that factory's routers/oracles/fee/pause config.
 *
 *   FORK=1 npx hardhat run scripts/deploy-agentvault.ts           # dry-run on a Base fork
 *   npx hardhat run scripts/deploy-agentvault.ts --network base   # real mainnet deploy
 *
 * Steps:
 *   1. Read the live RebalancerFactory (config source) and sanity-check it.
 *   2. Estimate gas + cost for the AgentVaultFactory deploy.
 *   3. Deploy AgentVaultFactory(configFactory = RebalancerFactory).
 *   4. Print the factory + embedded AgentVault implementation addresses.
 *
 * The AgentVaultFactory constructor itself deploys the AgentVault implementation
 * (`new AgentVault()`), so this is a single deploy tx from our side.
 */

// Live non-custodial config factory on Base mainnet.
const CONFIG_FACTORY =
  process.env.CONFIG_FACTORY ?? "0x24bbf692267b84801D0052812eEDC2885Fc6E171";

async function main() {
  const [deployer] = await ethers.getSigners();
  const isFork = process.env.FORK === "1";

  console.log(`Network: ${network.name}  fork=${isFork}`);
  console.log("Deployer:", deployer.address);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Balance: ", ethers.formatEther(bal), "ETH");
  console.log("Config factory (RebalancerFactory):", CONFIG_FACTORY);

  // 1. Sanity-check the config factory actually looks like a RebalancerFactory.
  const cfg = await ethers.getContractAt("RebalancerFactory", CONFIG_FACTORY);
  try {
    const [feeRate, paused, impl] = await Promise.all([
      cfg.feeRate(),
      cfg.paused(),
      cfg.implementation(),
    ]);
    console.log(`  feeRate=${feeRate} paused=${paused} userVaultImpl=${impl}`);
  } catch (e: any) {
    throw new Error(
      `Config factory read failed — wrong address or not a RebalancerFactory? ${e.message}`
    );
  }

  // 2. Estimate gas + cost before broadcasting.
  const Factory = await ethers.getContractFactory("AgentVaultFactory");
  const deployTx = await Factory.getDeployTransaction(CONFIG_FACTORY);
  const gas = await ethers.provider.estimateGas({
    ...deployTx,
    from: deployer.address,
  });
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  console.log(
    `\nEstimated gas: ${gas}  @ ${ethers.formatUnits(gasPrice, "gwei")} gwei` +
      `  ~= ${ethers.formatEther(gas * gasPrice)} ETH`
  );

  if (bal < gas * gasPrice) {
    throw new Error("Deployer balance below estimated gas cost — top up first.");
  }

  if (process.env.CONFIRM !== "1" && !isFork) {
    console.log(
      "\nDry-run only. Re-run with CONFIRM=1 to broadcast the real deploy:\n" +
        "  CONFIRM=1 npx hardhat run scripts/deploy-agentvault.ts --network base"
    );
    return;
  }

  // 3. Deploy.
  const factory = await Factory.deploy(CONFIG_FACTORY);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  // Reads right after deploy can hit a lagging RPC node — retry a few times.
  const retryRead = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    for (let i = 0; i < 5; i++) {
      try {
        return await fn();
      } catch {
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    return null;
  };

  const impl = await retryRead(() => factory.implementation());

  console.log("\n=== DEPLOYED ===");
  console.log(
    JSON.stringify(
      {
        agentVaultFactory: factoryAddr,
        agentVaultImpl: impl,
        configFactory: CONFIG_FACTORY,
      },
      null,
      2
    )
  );
  console.log(
    "\nNext:\n" +
      "  - verify on BaseScan:\n" +
      `      npx hardhat verify --network base ${factoryAddr} ${CONFIG_FACTORY}\n` +
      `      npx hardhat verify --network base ${impl}\n` +
      "  - set NEXT_PUBLIC_AGENT_FACTORY_ADDRESS in packages/web/.env\n" +
      "  - export the AgentVault ABI to the web app"
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
