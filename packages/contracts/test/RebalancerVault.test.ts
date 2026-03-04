import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("RebalancerVault V3", function () {
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const WETH = "0x4200000000000000000000000000000000000006";
  const ZERO = ethers.ZeroAddress;
  const SWAP_TARGET = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"; // LI.FI Diamond

  async function deployFixture() {
    const [owner, executor, user, other] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("RebalancerVault");
    const vault = await Vault.deploy(executor.address);
    return { vault, owner, executor, user, other };
  }

  // ─── Constructor ───────────────────────────────────────
  describe("Constructor", function () {
    it("should set executor", async function () {
      const { vault, executor } = await loadFixture(deployFixture);
      expect(await vault.executor()).to.equal(executor.address);
    });

    it("should set owner to deployer", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("should set feeCollector to deployer", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      expect(await vault.feeCollector()).to.equal(owner.address);
    });

    it("should set default feeRate to 15 (0.15%)", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.feeRate()).to.equal(15);
    });

    it("should reject zero executor", async function () {
      const Vault = await ethers.getContractFactory("RebalancerVault");
      await expect(Vault.deploy(ZERO)).to.be.revertedWithCustomError(
        Vault,
        "ZeroAddress"
      );
    });
  });

  // ─── setExecutor ───────────────────────────────────────
  describe("setExecutor", function () {
    it("should update executor (owner only)", async function () {
      const { vault, owner, other } = await loadFixture(deployFixture);
      await vault.connect(owner).setExecutor(other.address);
      expect(await vault.executor()).to.equal(other.address);
    });

    it("should reject from non-owner", async function () {
      const { vault, user, other } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).setExecutor(other.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should reject zero address", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await expect(
        vault.connect(owner).setExecutor(ZERO)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  // ─── SC1: setSwapTarget ────────────────────────────────
  describe("setSwapTarget (SC1)", function () {
    it("should whitelist a swap target", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await vault.connect(owner).setSwapTarget(SWAP_TARGET, true);
      expect(await vault.allowedSwapTargets(SWAP_TARGET)).to.be.true;
    });

    it("should remove a swap target", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await vault.connect(owner).setSwapTarget(SWAP_TARGET, true);
      await vault.connect(owner).setSwapTarget(SWAP_TARGET, false);
      expect(await vault.allowedSwapTargets(SWAP_TARGET)).to.be.false;
    });

    it("should reject from non-owner", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).setSwapTarget(SWAP_TARGET, true)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should reject zero address", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await expect(
        vault.connect(owner).setSwapTarget(ZERO, true)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  // ─── SC6: Pausable ─────────────────────────────────────
  describe("Pausable (SC6)", function () {
    it("should pause and unpause", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await vault.connect(owner).pause();
      expect(await vault.paused()).to.be.true;
      await vault.connect(owner).unpause();
      expect(await vault.paused()).to.be.false;
    });

    it("should reject pause from non-owner", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).pause()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ─── SC8: Per-user pause ───────────────────────────────
  describe("setUserPaused (SC8)", function () {
    it("should pause a user", async function () {
      const { vault, owner, user } = await loadFixture(deployFixture);
      await vault.connect(owner).setUserPaused(user.address, true);
      expect(await vault.userPaused(user.address)).to.be.true;
    });

    it("should unpause a user", async function () {
      const { vault, owner, user } = await loadFixture(deployFixture);
      await vault.connect(owner).setUserPaused(user.address, true);
      await vault.connect(owner).setUserPaused(user.address, false);
      expect(await vault.userPaused(user.address)).to.be.false;
    });

    it("should reject from non-owner", async function () {
      const { vault, user, other } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).setUserPaused(other.address, true)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Deposit ───────────────────────────────────────────
  describe("deposit", function () {
    it("should reject deposit of 0", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).deposit(USDC, 0)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("should reject deposit of zero address token (SC9)", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).deposit(ZERO, 100)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("should reject deposit to non-contract address (SC10)", async function () {
      const { vault, user, other } = await loadFixture(deployFixture);
      // other.address is an EOA, not a contract
      await expect(
        vault.connect(user).deposit(other.address, 100)
      ).to.be.revertedWithCustomError(vault, "NotAContract");
    });

    it("should reject deposit when paused (SC6)", async function () {
      const { vault, owner, user } = await loadFixture(deployFixture);
      await vault.connect(owner).pause();
      await expect(
        vault.connect(user).deposit(USDC, 100)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  // ─── Withdraw ──────────────────────────────────────────
  describe("withdraw", function () {
    it("should reject withdraw of 0", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).withdraw(USDC, 0)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("should reject withdraw of zero address token (SC9)", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).withdraw(ZERO, 100)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("should reject withdraw with insufficient balance", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).withdraw(USDC, 100)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("should reject withdraw when paused (SC6)", async function () {
      const { vault, owner, user } = await loadFixture(deployFixture);
      await vault.connect(owner).pause();
      await expect(
        vault.connect(user).withdraw(USDC, 100)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  // ─── executeRebalance ──────────────────────────────────
  describe("executeRebalance", function () {
    it("should reject from non-executor", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).executeRebalance(
          user.address, USDC, WETH, 1000,
          SWAP_TARGET, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "OnlyExecutor");
    });

    it("should reject zero amount", async function () {
      const { vault, executor, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, WETH, 0,
          SWAP_TARGET, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("should reject zero user address (SC9)", async function () {
      const { vault, executor } = await loadFixture(deployFixture);
      await expect(
        vault.connect(executor).executeRebalance(
          ZERO, USDC, WETH, 1000,
          SWAP_TARGET, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("should reject same fromToken and toToken (SC5)", async function () {
      const { vault, executor, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, USDC, 1000,
          SWAP_TARGET, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "SameToken");
    });

    it("should reject non-whitelisted swapTarget (SC1)", async function () {
      const { vault, executor, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, WETH, 1000,
          SWAP_TARGET, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "SwapTargetNotAllowed");
    });

    it("should reject swapTarget == fromToken (SC2)", async function () {
      const { vault, owner, executor, user } = await loadFixture(deployFixture);
      await vault.connect(owner).setSwapTarget(USDC, true);
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, WETH, 1000,
          USDC, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "InvalidSwapTarget");
    });

    it("should reject swapTarget == toToken (SC2)", async function () {
      const { vault, owner, executor, user } = await loadFixture(deployFixture);
      await vault.connect(owner).setSwapTarget(WETH, true);
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, WETH, 1000,
          WETH, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "InvalidSwapTarget");
    });

    it("should reject swapTarget == vault (SC2)", async function () {
      const { vault, owner, executor, user } = await loadFixture(deployFixture);
      const vaultAddr = await vault.getAddress();
      await vault.connect(owner).setSwapTarget(vaultAddr, true);
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, WETH, 1000,
          vaultAddr, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "InvalidSwapTarget");
    });

    it("should reject when globally paused (SC6)", async function () {
      const { vault, owner, executor, user } = await loadFixture(deployFixture);
      await vault.connect(owner).pause();
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, WETH, 1000,
          SWAP_TARGET, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("should reject when user is paused (SC8)", async function () {
      const { vault, owner, executor, user } = await loadFixture(deployFixture);
      await vault.connect(owner).setSwapTarget(SWAP_TARGET, true);
      await vault.connect(owner).setUserPaused(user.address, true);
      await expect(
        vault.connect(executor).executeRebalance(
          user.address, USDC, WETH, 1000,
          SWAP_TARGET, "0x", 0
        )
      ).to.be.revertedWithCustomError(vault, "UserIsPaused");
    });
  });

  // ─── Fee management ────────────────────────────────────
  describe("Fee management", function () {
    it("should have default feeRate of 15 (0.15%)", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.feeRate()).to.equal(15);
    });

    it("should set feeCollector to owner by default", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      expect(await vault.feeCollector()).to.equal(owner.address);
    });

    it("should update feeRate (owner only)", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await vault.connect(owner).setFeeRate(30); // 0.30%
      expect(await vault.feeRate()).to.equal(30);
    });

    it("should reject feeRate > MAX_FEE_RATE (1%)", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await expect(
        vault.connect(owner).setFeeRate(101)
      ).to.be.revertedWithCustomError(vault, "FeeTooHigh");
    });

    it("should allow feeRate = 0 (no fee)", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await vault.connect(owner).setFeeRate(0);
      expect(await vault.feeRate()).to.equal(0);
    });

    it("should update feeCollector (owner only)", async function () {
      const { vault, owner, other } = await loadFixture(deployFixture);
      await vault.connect(owner).setFeeCollector(other.address);
      expect(await vault.feeCollector()).to.equal(other.address);
    });

    it("should reject setFeeRate from non-owner", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).setFeeRate(10)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should reject setFeeCollector from non-owner", async function () {
      const { vault, user, other } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).setFeeCollector(other.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should reject setFeeCollector to zero address", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await expect(
        vault.connect(owner).setFeeCollector(ZERO)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  // ─── SC13: ETH Recovery ────────────────────────────────
  describe("withdrawETH (SC13)", function () {
    it("should reject from non-owner", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).withdrawETH()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should reject when no ETH balance", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await expect(
        vault.connect(owner).withdrawETH()
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("should receive and recover ETH", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      const vaultAddr = await vault.getAddress();

      // Send ETH to vault
      await owner.sendTransaction({
        to: vaultAddr,
        value: ethers.parseEther("0.01"),
      });
      expect(await ethers.provider.getBalance(vaultAddr)).to.equal(
        ethers.parseEther("0.01")
      );

      // Recover
      const ownerBalBefore = await ethers.provider.getBalance(owner.address);
      await vault.connect(owner).withdrawETH();
      expect(await ethers.provider.getBalance(vaultAddr)).to.equal(0n);

      const ownerBalAfter = await ethers.provider.getBalance(owner.address);
      // Owner balance should have increased (minus gas)
      expect(ownerBalAfter).to.be.greaterThan(ownerBalBefore);
    });
  });
});
