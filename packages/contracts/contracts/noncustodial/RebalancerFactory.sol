// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UserVault} from "./UserVault.sol";
import {IRebalancerFactory} from "./interfaces/IRebalancerFactory.sol";
import {IChainlinkAggregator} from "./interfaces/IChainlinkAggregator.sol";
import {TwapLib} from "./TwapLib.sol";

/// @title RebalancerFactory — deploys per-user vaults and holds shared config (SKELETON, UNAUDITED)
/// @notice Admin (ideally a multisig behind a timelock) manages: the operator address,
///         the router whitelist, Chainlink price feeds, the fee, and the kill-switch.
///         None of these powers grant custody of user funds — see UserVault for why.
/// @dev SKELETON. TODO before mainnet: timelock on every setter, audit, fuzz the oracle math.
contract RebalancerFactory is Ownable, IRebalancerFactory {
    // ─── Config (read by every vault) ────────────────────
    address public immutable implementation; // UserVault logic contract for clones

    address public operator;            // our server executor
    bool public paused;                 // blocks operator rebalances only
    uint256 public feeRate;             // bps, taken from swap output
    address public feeCollector;
    uint16 public maxSlippageCeilingBps; // hard cap on per-pair user slippage
    uint256 public maxPriceAge;          // oracle staleness threshold (seconds)

    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_RATE = 100; // 1% hard cap
    uint32 public constant MIN_TWAP_PERIOD = 300; // 5 min minimum TWAP window

    mapping(address => bool) public isRouterAllowed;
    mapping(address => IChainlinkAggregator) public priceFeeds; // token => USD feed
    /// Per-token oracle staleness window (seconds). 0 => fall back to global maxPriceAge.
    /// Needed because heartbeats differ wildly: ETH/USD ~hours, stablecoins ~24h on Base.
    mapping(address => uint256) public priceMaxAge;

    /// TWAP fallback for pairs whose tokens lack a Chainlink feed (e.g. meme tokens).
    /// Keyed by the sorted (tokenA, tokenB) pair. `period` is the TWAP window in seconds.
    struct TwapConfig {
        address pool;
        uint32 period;
    }
    mapping(bytes32 => TwapConfig) public twapPools;

    // ─── Vault registry ──────────────────────────────────
    mapping(address => address) public vaultOf; // user => vault (one per user)
    address[] public allVaults;

    // ─── Events ──────────────────────────────────────────
    event VaultDeployed(address indexed user, address indexed vault);
    event OperatorUpdated(address indexed oldOp, address indexed newOp);
    event RouterUpdated(address indexed router, bool allowed);
    event PriceFeedUpdated(address indexed token, address indexed feed, uint256 maxAge);
    event TwapPoolUpdated(address indexed tokenA, address indexed tokenB, address pool, uint32 period);
    event PausedSet(bool paused);
    event FeeUpdated(uint256 rate, address collector);
    event ParamsUpdated(uint16 maxSlippageCeilingBps, uint256 maxPriceAge);

    // ─── Errors ──────────────────────────────────────────
    error ZeroAddress();
    error VaultExists();
    error FeeTooHigh();
    error NoFeed();
    error StalePrice();
    error BadPrice();
    error TwapPeriodTooShort();

    constructor(
        address _operator,
        address _feeCollector,
        uint256 _feeRate,
        uint16 _maxSlippageCeilingBps,
        uint256 _maxPriceAge
    ) Ownable(msg.sender) {
        if (_operator == address(0) || _feeCollector == address(0)) revert ZeroAddress();
        if (_feeRate > MAX_FEE_RATE) revert FeeTooHigh();
        operator = _operator;
        feeCollector = _feeCollector;
        feeRate = _feeRate;
        maxSlippageCeilingBps = _maxSlippageCeilingBps;
        maxPriceAge = _maxPriceAge;

        // Deploy the logic contract once; all user vaults are cheap clones of it.
        implementation = address(new UserVault());
    }

    // ─── User-facing ─────────────────────────────────────

    /// @notice Deploy the caller's personal vault (one per address).
    function deployVault() external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert VaultExists();
        vault = Clones.clone(implementation);
        // Checks-effects-interactions: record state before the external init call.
        vaultOf[msg.sender] = vault;
        allVaults.push(vault);
        emit VaultDeployed(msg.sender, vault);
        UserVault(vault).initialize(msg.sender, address(this));
    }

    function vaultsCount() external view returns (uint256) {
        return allVaults.length;
    }

    // ─── Admin (onlyOwner — wrap in timelock/multisig) ───
    function setOperator(address _operator) external onlyOwner {
        if (_operator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, _operator);
        operator = _operator;
    }

    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        isRouterAllowed[router] = allowed;
        emit RouterUpdated(router, allowed);
    }

    /// @param maxAge per-token staleness window in seconds (0 => use global maxPriceAge).
    function setPriceFeed(address token, address feed, uint256 maxAge) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        priceFeeds[token] = IChainlinkAggregator(feed);
        priceMaxAge[token] = maxAge;
        emit PriceFeedUpdated(token, feed, maxAge);
    }

    /// @notice Register (or clear, pool=0) a TWAP pool for a token pair without feeds.
    /// @param period TWAP window in seconds; must be >= MIN_TWAP_PERIOD to resist manipulation.
    function setTwapPool(address tokenA, address tokenB, address pool, uint32 period) external onlyOwner {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) revert ZeroAddress();
        if (pool != address(0) && period < MIN_TWAP_PERIOD) revert TwapPeriodTooShort();
        twapPools[_pairKey(tokenA, tokenB)] = TwapConfig(pool, period);
        emit TwapPoolUpdated(tokenA, tokenB, pool, period);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function setFee(uint256 _feeRate, address _feeCollector) external onlyOwner {
        if (_feeRate > MAX_FEE_RATE) revert FeeTooHigh();
        if (_feeCollector == address(0)) revert ZeroAddress();
        feeRate = _feeRate;
        feeCollector = _feeCollector;
        emit FeeUpdated(_feeRate, _feeCollector);
    }

    function setParams(uint16 _maxSlippageCeilingBps, uint256 _maxPriceAge) external onlyOwner {
        maxSlippageCeilingBps = _maxSlippageCeilingBps;
        maxPriceAge = _maxPriceAge;
        emit ParamsUpdated(_maxSlippageCeilingBps, _maxPriceAge);
    }

    // ─── Oracle min-out ──────────────────────────────────

    /// @notice Fair output for `amountIn` of `from` in `to` units, minus slippage.
    /// @dev Prefers two USD Chainlink feeds. If either token lacks a feed, falls back
    ///      to a registered Uniswap-V3-style TWAP pool for the pair. Reverts if neither
    ///      a full Chainlink path nor a TWAP pool is available.
    function getMinOut(
        address from,
        address to,
        uint256 amountIn,
        uint16 maxSlippageBps
    ) external view returns (uint256 minOut) {
        uint256 fairOut;
        if (address(priceFeeds[from]) != address(0) && address(priceFeeds[to]) != address(0)) {
            fairOut = _chainlinkFairOut(from, to, amountIn);
        } else {
            TwapConfig memory cfg = twapPools[_pairKey(from, to)];
            if (cfg.pool == address(0)) revert NoFeed();
            int24 tick = TwapLib.consult(cfg.pool, cfg.period);
            fairOut = TwapLib.getQuoteAtTick(tick, amountIn, from, to);
        }
        minOut = (fairOut * (FEE_DENOMINATOR - maxSlippageBps)) / FEE_DENOMINATOR;
    }

    /// @dev Chainlink path: staged Math.mulDiv keeps every 512-bit intermediate bounded.
    ///      fairOut = amountIn * (pFrom/10^fdFrom) / (pTo/10^fdTo) * 10^decTo / 10^decFrom
    function _chainlinkFairOut(address from, address to, uint256 amountIn) internal view returns (uint256) {
        (uint256 pFrom, uint8 fdFrom) = _price(from);
        (uint256 pTo, uint8 fdTo) = _price(to);
        uint8 decFrom = IERC20Metadata(from).decimals();
        uint8 decTo = IERC20Metadata(to).decimals();
        uint256 base = Math.mulDiv(amountIn, pFrom, pTo);
        uint256 numScale = (10 ** fdTo) * (10 ** decTo);
        uint256 denScale = (10 ** fdFrom) * (10 ** decFrom);
        return Math.mulDiv(base, numScale, denScale);
    }

    function _pairKey(address a, address b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @notice True if this pair can be priced on-chain (both Chainlink feeds, or a
    ///         registered TWAP pool). Lets a vault tell "no oracle configured" apart
    ///         from "oracle exists but is stale" — only the former may use trusted mode.
    function hasOracle(address from, address to) external view returns (bool) {
        if (address(priceFeeds[from]) != address(0) && address(priceFeeds[to]) != address(0)) return true;
        return twapPools[_pairKey(from, to)].pool != address(0);
    }

    function _price(address token) internal view returns (uint256 price, uint8 feedDecimals) {
        IChainlinkAggregator feed = priceFeeds[token];
        if (address(feed) == address(0)) revert NoFeed();
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert BadPrice();
        uint256 maxAge = priceMaxAge[token];
        if (maxAge == 0) maxAge = maxPriceAge;
        if (block.timestamp - updatedAt > maxAge) revert StalePrice();
        return (uint256(answer), feed.decimals());
    }
}
