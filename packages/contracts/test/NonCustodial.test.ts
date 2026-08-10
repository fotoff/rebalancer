import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

// WETH ~ $2000 (18 dec), USDC ~ $1 (6 dec). Chainlink feeds use 8 decimals.
const ONE_WETH = ethers.parseUnits("1", 18);
const PRICE_WETH = ethers.parseUnits("2000", 8); // $2000
const PRICE_USDC = ethers.parseUnits("1", 8); //    $1
const FAIR_OUT = ethers.parseUnits("2000", 6); //   2000 USDC for 1 WETH
const MIN_OUT_1PCT = ethers.parseUnits("1980", 6); // 2000 - 1%
const BAD_OUT = ethers.parseUnits("1900", 6); //    -5%, below min-out
const FEE = ethers.parseUnits("3", 6); //           0.15% of 2000
const NET_OUT = ethers.parseUnits("1997", 6); //    2000 - fee

describe("Non-custodial RebalancerFactory + UserVault", function () {
  async function deployFixture() {
    const [admin, operator, user, attacker, feeCollector] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("MockERC20");
    const weth = await ERC20.deploy("Wrapped Ether", "WETH", 18);
    const usdc = await ERC20.deploy("USD Coin", "USDC", 6);

    const Agg = await ethers.getContractFactory("MockAggregator");
    const feedWeth = await Agg.deploy(8, PRICE_WETH);
    const feedUsdc = await Agg.deploy(8, PRICE_USDC);

    const Factory = await ethers.getContractFactory("RebalancerFactory");
    const factory = await Factory.deploy(
      operator.address,
      feeCollector.address,
      15, // 0.15% fee
      300, // max 3% per-pair slippage
      3600 // 1h oracle staleness
    );

    const Router = await ethers.getContractFactory("MockRouter");
    const router = await Router.deploy();

    const wethAddr = await weth.getAddress();
    const usdcAddr = await usdc.getAddress();
    const routerAddr = await router.getAddress();

    await factory.setPriceFeed(wethAddr, await feedWeth.getAddress(), 0);
    await factory.setPriceFeed(usdcAddr, await feedUsdc.getAddress(), 0);
    await factory.setRouterAllowed(routerAddr, true);

    // User deploys their personal vault and funds it with 1 WETH.
    await factory.connect(user).deployVault();
    const vaultAddr = await factory.vaultOf(user.address);
    const vault = await ethers.getContractAt("UserVault", vaultAddr);

    await weth.mint(user.address, ONE_WETH * 3n);
    await weth.connect(user).transfer(vaultAddr, ONE_WETH);

    // Allow WETH -> USDC, 1% slippage, no cooldown.
    await vault.connect(user).setPairPolicy(wethAddr, usdcAddr, true, 100, 0, false);

    const swapData = (amountIn: bigint, amountOut: bigint, recipient: string) =>
      router.interface.encodeFunctionData("swap", [
        wethAddr, usdcAddr, amountIn, amountOut, recipient,
      ]);

    return {
      admin, operator, user, attacker, feeCollector,
      weth, usdc, feedWeth, feedUsdc, factory, router,
      vault, vaultAddr, wethAddr, usdcAddr, routerAddr, swapData,
    };
  }

  // ─── Deployment ───────────────────────────────────────
  describe("Factory / vault deployment", function () {
    it("deploys one vault per user, owned by the user", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      expect(await vault.owner()).to.equal(user.address);
    });

    it("rejects a second vault for the same user", async function () {
      const { factory, user } = await loadFixture(deployFixture);
      await expect(factory.connect(user).deployVault())
        .to.be.revertedWithCustomError(factory, "VaultExists");
    });

    it("computes oracle min-out correctly (2000 - 1% = 1980 USDC)", async function () {
      const { factory, wethAddr, usdcAddr } = await loadFixture(deployFixture);
      expect(await factory.getMinOut(wethAddr, usdcAddr, ONE_WETH, 100))
        .to.equal(MIN_OUT_1PCT);
    });
  });

  // ─── Happy path ───────────────────────────────────────
  describe("Happy path", function () {
    it("operator rebalances at a fair price; net output stays with the user", async function () {
      const { operator, usdc, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData, feeCollector } =
        await loadFixture(deployFixture);

      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.emit(vault, "Rebalanced");

      // User's vault holds net output; fee went to the collector; WETH fully spent.
      expect(await usdc.balanceOf(vaultAddr)).to.equal(NET_OUT);
      expect(await usdc.balanceOf(feeCollector.address)).to.equal(FEE);
    });
  });

  // ─── The core guarantees ──────────────────────────────
  describe("Operator cannot steal", function () {
    it("reverts if the swap routes output to someone else (received = 0)", async function () {
      const { operator, attacker, weth, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData } =
        await loadFixture(deployFixture);

      // Operator tries to send the 2000 USDC to the attacker instead of the vault.
      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, attacker.address), 0)
      ).to.be.revertedWithCustomError(vault, "SlippageExceeded");

      // Revert rolled everything back: the WETH is still in the vault.
      expect(await weth.balanceOf(vaultAddr)).to.equal(ONE_WETH);
    });

    it("reverts if the price is worse than the oracle min-out", async function () {
      const { operator, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData } =
        await loadFixture(deployFixture);

      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, BAD_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "SlippageExceeded");
    });

    it("reverts on a pair the user did not allow", async function () {
      const { operator, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData } =
        await loadFixture(deployFixture);

      // USDC -> WETH was never allowed.
      await expect(
        vault.connect(operator).rebalance(usdcAddr, wethAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "PairNotAllowed");
    });

    it("reverts on a non-whitelisted router", async function () {
      const { operator, attacker, vault, vaultAddr, wethAddr, usdcAddr, swapData } =
        await loadFixture(deployFixture);

      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, attacker.address, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "RouterNotAllowed");
    });

    it("only the operator can call rebalance", async function () {
      const { attacker, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData } =
        await loadFixture(deployFixture);

      await expect(
        vault.connect(attacker).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "NotOperator");
    });
  });

  // ─── Withdrawal is the user's alone ───────────────────
  describe("Only the user controls funds", function () {
    it("operator/attacker cannot withdraw", async function () {
      const { operator, attacker, vault, wethAddr } = await loadFixture(deployFixture);
      await expect(vault.connect(operator).withdraw(wethAddr, ONE_WETH))
        .to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.connect(attacker).withdrawAll(wethAddr))
        .to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("user can always withdraw — even when the protocol is paused", async function () {
      const { factory, user, weth, vault, vaultAddr, wethAddr } = await loadFixture(deployFixture);
      await factory.setPaused(true);
      await vault.connect(user).withdrawAll(wethAddr);
      expect(await weth.balanceOf(user.address)).to.equal(ONE_WETH * 3n); // 2 unspent + 1 back
      expect(await weth.balanceOf(vaultAddr)).to.equal(0n);
    });
  });

  // ─── Pause / cooldown / staleness ─────────────────────
  describe("Guards", function () {
    it("pause blocks operator rebalances", async function () {
      const { factory, operator, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData } =
        await loadFixture(deployFixture);
      await factory.setPaused(true);
      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "ProtocolPaused");
    });

    it("enforces the per-pair cooldown", async function () {
      const { operator, user, weth, feedWeth, feedUsdc, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData } =
        await loadFixture(deployFixture);

      await vault.connect(user).setPairPolicy(wethAddr, usdcAddr, true, 100, 3600, false);
      await weth.connect(user).transfer(vaultAddr, ONE_WETH); // fund a 2nd swap

      await vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0);
      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(vault, "CooldownActive");

      await time.increase(3601);
      // Refresh oracle timestamps (otherwise they're now older than maxPriceAge).
      await feedWeth.setAnswer(PRICE_WETH);
      await feedUsdc.setAnswer(PRICE_USDC);
      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.emit(vault, "Rebalanced");
    });

    it("reverts on a stale oracle price", async function () {
      const { operator, feedWeth, routerAddr, vault, vaultAddr, wethAddr, usdcAddr, swapData, factory } =
        await loadFixture(deployFixture);

      // Push the feed timestamp far into the past.
      const now = await time.latest();
      await feedWeth.setUpdatedAt(now - 7200);
      await expect(
        factory.getMinOut(wethAddr, usdcAddr, ONE_WETH, 100)
      ).to.be.revertedWithCustomError(factory, "StalePrice");

      await expect(
        vault.connect(operator).rebalance(wethAddr, usdcAddr, ONE_WETH, routerAddr, swapData(ONE_WETH, FAIR_OUT, vaultAddr), 0)
      ).to.be.revertedWithCustomError(factory, "StalePrice");
    });
  });

  // ─── Funding ──────────────────────────────────────────
  describe("Deposits", function () {
    it("deposit() pulls tokens into the vault", async function () {
      const { user, weth, vault, vaultAddr, wethAddr } = await loadFixture(deployFixture);
      await weth.connect(user).approve(vaultAddr, ONE_WETH);
      await expect(vault.connect(user).deposit(wethAddr, ONE_WETH))
        .to.emit(vault, "Deposited");
      expect(await weth.balanceOf(vaultAddr)).to.equal(ONE_WETH * 2n); // 1 funded in fixture + 1
    });

    it("depositWithPermit() funds in a single tx (EIP-2612)", async function () {
      const { user, vault, vaultAddr } = await loadFixture(deployFixture);

      const Permit = await ethers.getContractFactory("MockERC20Permit");
      const tkn = await Permit.deploy("Permit USD", "pUSD", 6);
      const tknAddr = await tkn.getAddress();
      const amount = ethers.parseUnits("500", 6);
      await tkn.mint(user.address, amount);

      const net = await ethers.provider.getNetwork();
      const deadline = (await time.latest()) + 3600;
      const sig = await user.signTypedData(
        { name: "Permit USD", version: "1", chainId: net.chainId, verifyingContract: tknAddr },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        { owner: user.address, spender: vaultAddr, value: amount, nonce: await tkn.nonces(user.address), deadline }
      );
      const { v, r, s } = ethers.Signature.from(sig);

      await vault.connect(user).depositWithPermit(tknAddr, amount, deadline, v, r, s);
      expect(await tkn.balanceOf(vaultAddr)).to.equal(amount);
      expect(await tkn.allowance(user.address, vaultAddr)).to.equal(0n); // permit consumed
    });
  });

  // ─── User policy control ──────────────────────────────
  describe("User policy", function () {
    it("rejects slippage above the factory ceiling", async function () {
      const { vault, user, wethAddr, usdcAddr } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).setPairPolicy(wethAddr, usdcAddr, true, 301, 0, false)
      ).to.be.revertedWithCustomError(vault, "SlippageTooHigh");
    });

    it("non-owner cannot change policy", async function () {
      const { vault, attacker, wethAddr, usdcAddr } = await loadFixture(deployFixture);
      await expect(
        vault.connect(attacker).setPairPolicy(wethAddr, usdcAddr, true, 100, 0, false)
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });
  });
});

describe("TWAP oracle fallback", function () {
  async function twapFixture() {
    const [admin, operator, feeCollector] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("MockERC20");
    // Two feed-less tokens (e.g. meme + wrapped), 18 decimals.
    const meme = await ERC20.deploy("Meme", "MEME", 18);
    const weth = await ERC20.deploy("Wrapped Ether", "WETH", 18);
    const memeAddr = await meme.getAddress();
    const wethAddr = await weth.getAddress();

    const Factory = await ethers.getContractFactory("RebalancerFactory");
    const factory = await Factory.deploy(operator.address, feeCollector.address, 15, 300, 3600);

    // tick = 0 => 1:1 price in the pool.
    const [t0, t1] = memeAddr.toLowerCase() < wethAddr.toLowerCase()
      ? [memeAddr, wethAddr]
      : [wethAddr, memeAddr];
    const Pool = await ethers.getContractFactory("MockV3Pool");
    const pool = await Pool.deploy(t0, t1, 0);

    return { factory, meme, weth, memeAddr, wethAddr, pool };
  }

  it("reverts NoFeed when neither token has a feed and no TWAP pool", async function () {
    const { factory, memeAddr, wethAddr } = await loadFixture(twapFixture);
    await expect(
      factory.getMinOut(memeAddr, wethAddr, ethers.parseUnits("1", 18), 100)
    ).to.be.revertedWithCustomError(factory, "NoFeed");
  });

  it("rejects a TWAP period below the minimum", async function () {
    const { factory, memeAddr, wethAddr, pool } = await loadFixture(twapFixture);
    await expect(
      factory.setTwapPool(memeAddr, wethAddr, await pool.getAddress(), 60)
    ).to.be.revertedWithCustomError(factory, "TwapPeriodTooShort");
  });

  it("prices a feed-less pair via the TWAP pool (tick 0 => 1:1, minus slippage)", async function () {
    const { factory, memeAddr, wethAddr, pool } = await loadFixture(twapFixture);
    await factory.setTwapPool(memeAddr, wethAddr, await pool.getAddress(), 1800);

    // 1 MEME -> WETH at 1:1, 1% slippage => 0.99 WETH
    const minOut = await factory.getMinOut(memeAddr, wethAddr, ethers.parseUnits("1", 18), 100);
    expect(minOut).to.equal(ethers.parseUnits("0.99", 18));

    // direction is symmetric at tick 0
    const minOutRev = await factory.getMinOut(wethAddr, memeAddr, ethers.parseUnits("1", 18), 100);
    expect(minOutRev).to.equal(ethers.parseUnits("0.99", 18));
  });
});

describe("Trusted-quote mode (oracle-less pairs)", function () {
  const AMT = ethers.parseUnits("1", 18);

  async function fixture() {
    const [admin, operator, user, feeCollector] = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const a = await ERC20.deploy("MemeA", "MEMA", 18);
    const b = await ERC20.deploy("MemeB", "MEMB", 18);
    const aAddr = await a.getAddress();
    const bAddr = await b.getAddress();

    const Factory = await ethers.getContractFactory("RebalancerFactory");
    const factory = await Factory.deploy(operator.address, feeCollector.address, 0, 300, 3600);
    const Router = await ethers.getContractFactory("MockRouter");
    const router = await Router.deploy();
    const routerAddr = await router.getAddress();
    await factory.setRouterAllowed(routerAddr, true);

    await factory.connect(user).deployVault();
    const vaultAddr = await factory.vaultOf(user.address);
    const vault = await ethers.getContractAt("UserVault", vaultAddr);
    await a.mint(user.address, AMT * 5n);
    await a.connect(user).transfer(vaultAddr, AMT * 3n);

    const swapData = (amountIn: bigint, amountOut: bigint, recipient: string) =>
      router.interface.encodeFunctionData("swap", [aAddr, bAddr, amountIn, amountOut, recipient]);

    return { operator, user, factory, vault, vaultAddr, aAddr, bAddr, routerAddr, swapData };
  }

  it("reverts NoOracle when the pair has no feed and trust is OFF", async function () {
    const { operator, user, vault, vaultAddr, aAddr, bAddr, routerAddr, swapData } = await loadFixture(fixture);
    await vault.connect(user).setPairPolicy(aAddr, bAddr, true, 100, 0, false);
    await expect(
      vault.connect(operator).rebalance(aAddr, bAddr, AMT, routerAddr, swapData(AMT, AMT, vaultAddr), AMT)
    ).to.be.revertedWithCustomError(vault, "NoOracle");
  });

  it("uses the operator's min-out when trust is ON (no oracle)", async function () {
    const { operator, user, vault, vaultAddr, aAddr, bAddr, routerAddr, swapData } = await loadFixture(fixture);
    await vault.connect(user).setPairPolicy(aAddr, bAddr, true, 100, 0, true);
    const out = ethers.parseUnits("0.9", 18);
    await vault.connect(operator).rebalance(aAddr, bAddr, AMT, routerAddr, swapData(AMT, out, vaultAddr), out);
    const b = await ethers.getContractAt("MockERC20", bAddr);
    expect(await b.balanceOf(vaultAddr)).to.equal(out);
  });

  it("still reverts if delivered output is below the operator's claimed min-out", async function () {
    const { operator, user, vault, vaultAddr, aAddr, bAddr, routerAddr, swapData } = await loadFixture(fixture);
    await vault.connect(user).setPairPolicy(aAddr, bAddr, true, 100, 0, true);
    // claims 0.9 but only delivers 0.8 → revert
    await expect(
      vault.connect(operator).rebalance(aAddr, bAddr, AMT, routerAddr, swapData(AMT, ethers.parseUnits("0.8", 18), vaultAddr), ethers.parseUnits("0.9", 18))
    ).to.be.revertedWithCustomError(vault, "SlippageExceeded");
  });
});
