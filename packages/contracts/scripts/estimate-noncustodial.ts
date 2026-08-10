import { ethers, network } from "hardhat";

// Estimates total deploy cost on a Base fork: sums gasUsed of every tx and
// multiplies by the LIVE mainnet gas price. Read-only — broadcasts nothing real.
const ROUTER = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FEEDS: [string, string, number][] = [
  [WETH, "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", 3 * 3600],
  [USDC, "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", 25 * 3600],
];

async function main() {
  const [deployer] = await ethers.getSigners();
  let totalGas = 0n;
  const track = async (label: string, txp: Promise<any>) => {
    const tx = await txp;
    const r = await tx.deploymentTransaction?.()?.wait?.() ?? (await tx.wait?.());
    const used = r?.gasUsed ?? (await (await tx.deploymentTransaction().wait()).gasUsed);
    totalGas += used;
    console.log(`  ${label}: ${used} gas`);
  };

  const Factory = await ethers.getContractFactory("RebalancerFactory");
  const factory = await Factory.deploy(deployer.address, deployer.address, 15, 300, 3600);
  await factory.waitForDeployment();
  totalGas += (await factory.deploymentTransaction()!.wait())!.gasUsed;
  console.log(`  Factory(+impl): ${(await factory.deploymentTransaction()!.wait())!.gasUsed} gas`);

  await track("setRouterAllowed", factory.setRouterAllowed(ROUTER, true));
  for (const [t, f, a] of FEEDS) await track(`setPriceFeed`, factory.setPriceFeed(t, f, a));

  const Timelock = await ethers.getContractFactory("TimelockController");
  const tl = await Timelock.deploy(172800, [deployer.address], [deployer.address], deployer.address);
  await tl.waitForDeployment();
  totalGas += (await tl.deploymentTransaction()!.wait())!.gasUsed;
  console.log(`  Timelock: ${(await tl.deploymentTransaction()!.wait())!.gasUsed} gas`);

  await track("transferOwnership", factory.transferOwnership(await tl.getAddress()));

  const fee = await ethers.provider.getFeeData();
  const gp = fee.gasPrice ?? 0n;
  const l2cost = totalGas * gp;
  console.log(`\n  total L2 gas: ${totalGas}`);
  console.log(`  mainnet gasPrice: ${ethers.formatUnits(gp, "gwei")} gwei`);
  console.log(`  L2 cost: ${ethers.formatEther(l2cost)} ETH (NOTE: + Base L1 data fee, usually similar order)`);
  console.log(`  rough total estimate: ${ethers.formatEther(l2cost * 3n)} ETH (3x buffer for L1 fee)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
