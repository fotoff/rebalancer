import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * AgentVault: a user grants third-party agents a narrow, budgeted, expiring right
 * to trade. These tests focus on what an agent must NOT be able to do.
 */

const ONE = ethers.parseUnits("1", 18);
const PRICE_A = ethers.parseUnits("2000", 8); // $2000
const PRICE_B = ethers.parseUnits("1", 8); //    $1
const FAIR_OUT = ethers.parseUnits("2000", 6); // 2000 B for 1 A
const BAD_OUT = ethers.parseUnits("1500", 6);

describe("AgentVault", function () {
  async function deployFixture() {
    const [admin, agent, user, attacker, feeCollector] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("MockERC20");
    const tokenA = await ERC20.deploy("Token A", "AAA", 18);
    const tokenB = await ERC20.deploy("Token B", "BBB", 6);

    const Agg = await ethers.getContractFactory("MockAggregator");
    const feedA = await Agg.deploy(8, PRICE_A);
    const feedB = await Agg.deploy(8, PRICE_B);

    const Config = await ethers.getContractFactory("RebalancerFactory");
    const config = await Config.deploy(admin.address, feeCollector.address, 0, 300, 3600);

    const Router = await ethers.getContractFactory("MockRouter");
    const router = await Router.deploy();

    const aAddr = await tokenA.getAddress();
    const bAddr = await tokenB.getAddress();
    const routerAddr = await router.getAddress();

    await config.setPriceFeed(aAddr, await feedA.getAddress(), 0);
    await config.setPriceFeed(bAddr, await feedB.getAddress(), 0);
    await config.setRouterAllowed(routerAddr, true);

    const Factory = await ethers.getContractFactory("AgentVaultFactory");
    const factory = await Factory.deploy(await config.getAddress());

    await factory.connect(user).deployAgentVault();
    const vaultAddr = await factory.vaultOf(user.address);
    const vault = await ethers.getContractAt("AgentVault", vaultAddr);

    await tokenA.mint(user.address, ONE * 100n);
    await tokenA.connect(user).transfer(vaultAddr, ONE * 10n);

    const swapData = (amountIn: bigint, amountOut: bigint, recipient: string) =>
      router.interface.encodeFunctionData("swap", [aAddr, bAddr, amountIn, amountOut, recipient]);

    return {
      admin, agent, user, attacker, feeCollector,
      config, factory, vault, vaultAddr, router, routerAddr, feedA, feedB,
      tokenA, tokenB, aAddr, bAddr, swapData,
    };
  }

  /** Grant the agent a permissive default so individual tests can tighten one knob. */
  async function permit(
    vault: any, user: any, agent: any, aAddr: string, bAddr: string,
    over: Partial<{ slippage: number; cooldown: number; expiresAt: number; maxNotional: bigint; trust: boolean }> = {}
  ) {
    await vault.connect(user).setAgentPermission(
      agent.address, aAddr, bAddr, true,
      over.slippage ?? 100,
      over.cooldown ?? 0,
      over.expiresAt ?? 0,
      over.maxNotional ?? 0n,
      over.trust ?? false
    );
  }

  describe("Deployment", function () {
    it("gives the user ownership of their agent vault", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      expect(await vault.owner()).to.equal(user.address);
    });

    it("allows only one vault per user", async function () {
      const { factory, user } = await loadFixture(deployFixture);
      await expect(factory.connect(user).deployAgentVault()).to.be.revertedWithCustomError(
        factory, "VaultExists"
      );
    });
  });

  describe("Only the user controls funds", function () {
    it("agent cannot withdraw", async function () {
      const { vault, agent, aAddr } = await loadFixture(deployFixture);
      await expect(
        vault.connect(agent).withdraw(aAddr, ONE)
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("agent cannot grant itself permissions", async function () {
      const { vault, agent, aAddr, bAddr } = await loadFixture(deployFixture);
      await expect(
        vault.connect(agent).setAgentPermission(agent.address, aAddr, bAddr, true, 100, 0, 0, 0n, true)
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("user can always withdraw", async function () {
      const { vault, user, tokenA, aAddr } = await loadFixture(deployFixture);
      const before = await tokenA.balanceOf(user.address);
      await vault.connect(user).withdrawAll(aAddr);
      expect(await tokenA.balanceOf(user.address)).to.be.greaterThan(before);
    });
  });

  describe("Agent limits", function () {
    it("rejects an agent with no permission", async function () {
      const { vault, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr } = await loadFixture(deployFixture);
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "NotPermitted");
    });

    it("executes a permitted trade and keeps output in the vault", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr, tokenB } =
        await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      await vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0);
      expect(await tokenB.balanceOf(vaultAddr)).to.equal(FAIR_OUT);
    });

    it("reverts when the agent routes output to itself", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, agent.address), 0)
      ).to.be.revertedWithCustomError(vault, "SlippageExceeded");
    });

    it("enforces the oracle floor even if the agent claims a low min-out", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, BAD_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "SlippageExceeded");
    });

    it("enforces max notional per trade", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr, { maxNotional: ONE / 2n });
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "NotionalTooLarge");
    });

    it("enforces expiry", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr } = await loadFixture(deployFixture);
      const now = await time.latest();
      await permit(vault, user, agent, aAddr, bAddr, { expiresAt: now + 100 });
      await time.increase(200);
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "PermissionExpired");
    });

    it("enforces cooldown between trades", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr, { cooldown: 3600 });
      await vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0);
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "CooldownActive");
    });

    it("revoking a pair stops the agent immediately", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      await vault.connect(user).revokeAgentPair(agent.address, aAddr, bAddr);
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "NotPermitted");
    });

    it("does not let one agent use another agent's grant", async function () {
      const { vault, user, agent, attacker, aAddr, bAddr, routerAddr, swapData, vaultAddr } =
        await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      await expect(
        vault.connect(attacker).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "NotPermitted");
    });
  });

  describe("Rolling budget", function () {
    it("blocks spending past the daily cap", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      await vault.connect(user).setAgentBudget(agent.address, aAddr, ONE); // 1 token/day

      await vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0);
      await expect(
        vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "BudgetExceeded");
    });

    it("refills after the window passes", async function () {
      const { vault, user, agent, aAddr, bAddr, routerAddr, swapData, vaultAddr, feedA, feedB } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      await vault.connect(user).setAgentBudget(agent.address, aAddr, ONE);

      await vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0);
      await time.increase(24 * 3600 + 1);
      // Refresh the mock feeds: after a day of time travel the oracle is
      // legitimately stale, and a stale oracle must (and does) block trades.
      await feedA.setAnswer(PRICE_A);
      await feedB.setAnswer(PRICE_B);
      await vault.connect(agent).agentTrade(aAddr, bAddr, ONE, routerAddr, swapData(ONE, FAIR_OUT, vaultAddr), 0);
      expect(await vault.remainingBudget(agent.address, aAddr)).to.equal(0n);
    });

    it("reports remaining budget", async function () {
      const { vault, user, agent, aAddr } = await loadFixture(deployFixture);
      await vault.connect(user).setAgentBudget(agent.address, aAddr, ONE * 5n);
      expect(await vault.remainingBudget(agent.address, aAddr)).to.equal(ONE * 5n);
    });
  });

  describe("canTrade preflight", function () {
    it("explains why a trade is not allowed", async function () {
      const { vault, agent, aAddr, bAddr } = await loadFixture(deployFixture);
      const [ok, reason] = await vault.canTrade(agent.address, aAddr, bAddr, ONE);
      expect(ok).to.equal(false);
      expect(reason).to.equal("not permitted");
    });

    it("returns true once permitted", async function () {
      const { vault, user, agent, aAddr, bAddr } = await loadFixture(deployFixture);
      await permit(vault, user, agent, aAddr, bAddr);
      const [ok] = await vault.canTrade(agent.address, aAddr, bAddr, ONE);
      expect(ok).to.equal(true);
    });
  });
});
