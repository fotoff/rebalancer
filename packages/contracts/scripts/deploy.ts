import { ethers } from "hardhat";

// LI.FI Diamond on Base — the primary DEX aggregator
const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";

async function main() {
  const [deployer] = await ethers.getSigners();
  const executor = process.env.EXECUTOR_ADDRESS || deployer.address;

  console.log("Deployer address:", deployer.address);
  console.log("Deploying RebalancerVault V3 with:", { executor });

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    throw new Error("Deployer has no ETH for gas. Fund the address first.");
  }

  const Vault = await ethers.getContractFactory("RebalancerVault");
  const vault = await Vault.deploy(executor);

  await vault.waitForDeployment();
  const address = await vault.getAddress();

  console.log("\n=== DEPLOYMENT SUCCESSFUL ===");
  console.log("RebalancerVault V3 deployed to:", address);
  console.log("Owner (can setExecutor, setSwapTarget, pause):", deployer.address);
  console.log("Executor:", executor);

  // Whitelist LI.FI Diamond as swap target (SC1)
  console.log("\nWhitelisting LI.FI Diamond as swap target...");
  const tx = await vault.setSwapTarget(LIFI_DIAMOND, true);
  await tx.wait();
  console.log(`✅ LI.FI Diamond (${LIFI_DIAMOND}) whitelisted`);

  console.log("\n=== NEXT STEPS ===");
  console.log(`1. Set NEXT_PUBLIC_VAULT_ADDRESS=${address} in packages/web/.env.local`);
  console.log(`2. Set VAULT_ADDRESS=${address} in trigger-checker ecosystem.config.cjs`);
  console.log("3. Fund executor wallet with ~0.005 ETH on Base for gas");
  console.log("4. Withdraw tokens from old vault and deposit to new vault");
  console.log(`5. Verify: npx hardhat verify --network base ${address} ${executor}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
