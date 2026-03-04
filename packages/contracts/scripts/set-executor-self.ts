import { ethers } from "hardhat";

const VAULT_ADDRESS = "0x3310c9504a7f74d892FB7a527f417d4d46aD78a0";
const NEW_EXECUTOR = "0x66eE7dc2FF768c253C5CeDAa86dfeAea31f47714";

/**
 * Set executor on RebalancerVault to the dedicated executor wallet.
 * This allows the self-hosted trigger-checker to call executeRebalance.
 * Owner key signs the tx locally, executor key lives on the server.
 */
async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer (owner):", signer.address);

  const vault = new ethers.Contract(
    VAULT_ADDRESS,
    [
      "function setExecutor(address _executor) external",
      "function executor() view returns (address)",
      "function owner() view returns (address)",
    ],
    signer
  );

  // Check current executor
  const currentExecutor = await vault.executor();
  console.log("Current executor:", currentExecutor);
  console.log("New executor:   ", NEW_EXECUTOR);

  if (currentExecutor.toLowerCase() === NEW_EXECUTOR.toLowerCase()) {
    console.log("\n✅ Executor is already set. No change needed.");
    return;
  }

  // Check we are the owner
  const owner = await vault.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(`\n❌ Not the owner. Owner is ${owner}`);
    return;
  }

  console.log("\nSetting executor to new wallet...");
  const tx = await vault.setExecutor(NEW_EXECUTOR);
  console.log("TX hash:", tx.hash);
  const receipt = await tx.wait();
  console.log(`✅ Executor updated in block ${receipt.blockNumber}`);

  // Verify
  const newExecutor = await vault.executor();
  console.log("Verified executor:", newExecutor);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
