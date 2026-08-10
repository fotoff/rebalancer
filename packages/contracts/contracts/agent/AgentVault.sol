// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IRebalancerFactory} from "../noncustodial/interfaces/IRebalancerFactory.sol";

/// @title AgentVault — safe execution layer for autonomous trading agents (SKELETON, UNAUDITED)
/// @notice A user-owned vault that can grant *several* agents a narrow, revocable,
///         budgeted right to trade on their behalf — without ever handing over custody.
///
/// This runs alongside UserVault rather than replacing it: UserVault serves our own
/// operator, AgentVault opens the same guarantees to third-party agents.
///
/// Per-agent limits the user sets:
///   • allowed directional pairs (from -> to)
///   • max notional per single trade
///   • rolling 24h spend budget
///   • expiry (a session key that dies on its own)
///   • cooldown between trades
///
/// Invariants that hold no matter what an agent does:
///   • only `owner` can withdraw — agents have no path to move funds out
///   • swap output is measured on this contract, so routing it elsewhere reverts
///   • when an oracle exists, min-out comes from the oracle, not from the agent
contract AgentVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────
    IRebalancerFactory public factory; // shared config: routers, oracles, pause
    address public owner;              // the user

    struct AgentPermission {
        bool enabled;
        uint16 maxSlippageBps;
        uint32 cooldown;        // seconds between trades for this agent+pair
        uint64 lastExec;
        uint64 expiresAt;       // 0 = never expires
        uint128 maxNotional;    // max `amountIn` per single trade (0 = unlimited)
        bool trustAgentMinOut;  // allow agent-supplied min-out when no oracle exists
    }

    /// agent => pairKey(from,to) => permission
    mapping(address => mapping(bytes32 => AgentPermission)) public permissions;

    struct Budget {
        uint128 dailyLimit;   // max notional per rolling window (0 = unlimited)
        uint128 spentInWindow;
        uint64 windowStart;
    }
    /// agent => token => rolling budget for spending that token
    mapping(address => mapping(address => Budget)) public budgets;

    uint64 public constant BUDGET_WINDOW = 1 days;

    // ─── Events ──────────────────────────────────────────
    event Initialized(address indexed owner, address indexed factory);
    event AgentPermissionSet(
        address indexed agent,
        address indexed from,
        address indexed to,
        bool enabled,
        uint16 maxSlippageBps,
        uint64 expiresAt,
        uint128 maxNotional
    );
    event AgentBudgetSet(address indexed agent, address indexed token, uint128 dailyLimit);
    event AgentRevoked(address indexed agent);
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AgentTraded(
        address indexed agent,
        address indexed from,
        address indexed to,
        uint256 amountIn,
        uint256 netOut,
        uint256 fee
    );

    // ─── Errors ──────────────────────────────────────────
    error NotOwner();
    error ZeroAddress();
    error SameToken();
    error SlippageTooHigh();
    error NotPermitted();
    error PermissionExpired();
    error CooldownActive();
    error RouterNotAllowed();
    error ProtocolPaused();
    error BadAmount();
    error NotionalTooLarge();
    error BudgetExceeded();
    error SwapFailed();
    error SlippageExceeded();
    error NoOracle();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, address _factory) external initializer {
        if (_owner == address(0) || _factory == address(0)) revert ZeroAddress();
        owner = _owner;
        factory = IRebalancerFactory(_factory);
        emit Initialized(_owner, _factory);
    }

    function _key(address from, address to) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(from, to));
    }

    // ─── Funding ─────────────────────────────────────────
    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert BadAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    /// @notice Withdraw. Always available to the owner — no pause, no agent, can block it.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert BadAmount();
        IERC20(token).safeTransfer(owner, amount);
        emit Withdrawn(token, owner, amount);
    }

    function withdrawAll(address token) external onlyOwner nonReentrant {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert BadAmount();
        IERC20(token).safeTransfer(owner, bal);
        emit Withdrawn(token, owner, bal);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─── Agent permissioning (onlyOwner) ─────────────────

    /// @notice Grant/revoke one agent the right to trade one direction of one pair.
    /// @param expiresAt unix seconds after which the grant is dead (0 = no expiry)
    /// @param maxNotional largest `amountIn` per trade (0 = unlimited)
    function setAgentPermission(
        address agent,
        address from,
        address to,
        bool enabled,
        uint16 maxSlippageBps,
        uint32 cooldown,
        uint64 expiresAt,
        uint128 maxNotional,
        bool trustAgentMinOut
    ) external onlyOwner {
        if (agent == address(0) || from == address(0) || to == address(0)) revert ZeroAddress();
        if (from == to) revert SameToken();
        if (maxSlippageBps > factory.maxSlippageCeilingBps()) revert SlippageTooHigh();

        AgentPermission storage p = permissions[agent][_key(from, to)];
        p.enabled = enabled;
        p.maxSlippageBps = maxSlippageBps;
        p.cooldown = cooldown;
        p.expiresAt = expiresAt;
        p.maxNotional = maxNotional;
        p.trustAgentMinOut = trustAgentMinOut;

        emit AgentPermissionSet(agent, from, to, enabled, maxSlippageBps, expiresAt, maxNotional);
    }

    /// @notice Cap how much of `token` an agent may spend per rolling 24h window.
    function setAgentBudget(address agent, address token, uint128 dailyLimit) external onlyOwner {
        if (agent == address(0) || token == address(0)) revert ZeroAddress();
        Budget storage b = budgets[agent][token];
        b.dailyLimit = dailyLimit;
        // Reset the window so a raised limit takes effect immediately.
        b.spentInWindow = 0;
        b.windowStart = uint64(block.timestamp);
        emit AgentBudgetSet(agent, token, dailyLimit);
    }

    /// @notice Kill switch for one agent across a specific pair direction.
    function revokeAgentPair(address agent, address from, address to) external onlyOwner {
        permissions[agent][_key(from, to)].enabled = false;
        emit AgentRevoked(agent);
    }

    // ─── Agent execution ─────────────────────────────────

    /// @notice Execute a trade as a permitted agent, inside every limit the user set.
    function agentTrade(
        address from,
        address to,
        uint256 amountIn,
        address router,
        bytes calldata swapData,
        uint256 agentMinOut
    ) external nonReentrant returns (uint256 received) {
        if (factory.paused()) revert ProtocolPaused();

        AgentPermission storage p = permissions[msg.sender][_key(from, to)];
        if (!p.enabled) revert NotPermitted();
        if (p.expiresAt != 0 && block.timestamp > p.expiresAt) revert PermissionExpired();
        if (block.timestamp < uint256(p.lastExec) + p.cooldown) revert CooldownActive();
        if (!factory.isRouterAllowed(router)) revert RouterNotAllowed();
        if (amountIn == 0 || amountIn > IERC20(from).balanceOf(address(this))) revert BadAmount();
        if (p.maxNotional != 0 && amountIn > p.maxNotional) revert NotionalTooLarge();

        _chargeBudget(msg.sender, from, amountIn);

        // Oracle floor when available; agent's quote only for oracle-less pairs the
        // user explicitly opted into trusting.
        uint256 minOut;
        if (factory.hasOracle(from, to)) {
            uint256 oracleMin = factory.getMinOut(from, to, amountIn, p.maxSlippageBps);
            minOut = oracleMin > agentMinOut ? oracleMin : agentMinOut;
        } else {
            if (!p.trustAgentMinOut) revert NoOracle();
            if (agentMinOut == 0) revert BadAmount();
            minOut = agentMinOut;
        }

        uint256 toBefore = IERC20(to).balanceOf(address(this));

        IERC20(from).forceApprove(router, amountIn);
        (bool ok, ) = router.call(swapData);
        IERC20(from).forceApprove(router, 0);
        if (!ok) revert SwapFailed();

        received = IERC20(to).balanceOf(address(this)) - toBefore;
        if (received < minOut) revert SlippageExceeded();

        p.lastExec = uint64(block.timestamp);

        uint256 fee = (received * factory.feeRate()) / 10000;
        if (fee > 0) {
            IERC20(to).safeTransfer(factory.feeCollector(), fee);
        }

        emit AgentTraded(msg.sender, from, to, amountIn, received - fee, fee);
    }

    /// @dev Rolling-window budget accounting; reverts when the agent is over cap.
    function _chargeBudget(address agent, address token, uint256 amount) internal {
        Budget storage b = budgets[agent][token];
        if (b.dailyLimit == 0) return; // unlimited

        if (block.timestamp >= uint256(b.windowStart) + BUDGET_WINDOW) {
            b.windowStart = uint64(block.timestamp);
            b.spentInWindow = 0;
        }
        uint256 spent = uint256(b.spentInWindow) + amount;
        if (spent > b.dailyLimit) revert BudgetExceeded();
        b.spentInWindow = uint128(spent);
    }

    // ─── Views for agents / UIs ──────────────────────────

    /// @notice How much of `token` this agent may still spend in the current window.
    function remainingBudget(address agent, address token) external view returns (uint256) {
        Budget memory b = budgets[agent][token];
        if (b.dailyLimit == 0) return type(uint256).max;
        if (block.timestamp >= uint256(b.windowStart) + BUDGET_WINDOW) return b.dailyLimit;
        return b.dailyLimit - b.spentInWindow;
    }

    /// @notice Whether an agent could trade this pair right now, and why not.
    function canTrade(
        address agent,
        address from,
        address to,
        uint256 amountIn
    ) external view returns (bool allowed, string memory reason) {
        AgentPermission memory p = permissions[agent][_key(from, to)];
        if (!p.enabled) return (false, "not permitted");
        if (p.expiresAt != 0 && block.timestamp > p.expiresAt) return (false, "expired");
        if (block.timestamp < uint256(p.lastExec) + p.cooldown) return (false, "cooldown");
        if (factory.paused()) return (false, "protocol paused");
        if (amountIn == 0 || amountIn > IERC20(from).balanceOf(address(this)))
            return (false, "insufficient balance");
        if (p.maxNotional != 0 && amountIn > p.maxNotional) return (false, "notional too large");

        Budget memory b = budgets[agent][from];
        if (b.dailyLimit != 0) {
            uint256 spent = block.timestamp >= uint256(b.windowStart) + BUDGET_WINDOW
                ? 0
                : b.spentInWindow;
            if (spent + amountIn > b.dailyLimit) return (false, "budget exceeded");
        }
        return (true, "");
    }
}
