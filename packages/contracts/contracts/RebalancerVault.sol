// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title RebalancerVault V3
/// @notice Custodial vault for rebalancing via whitelisted DEX aggregators (LI.FI, etc.)
/// @dev Users deposit tokens, trusted executor triggers swaps through generic calldata.
///      V3 changes: swapTarget whitelist, ReentrancyGuard, Pausable, partial fill handling,
///      per-user pause, fee-on-transfer protection, ETH recovery, swap fee.
contract RebalancerVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────
    uint256 public constant MAX_FEE_RATE = 100; // Max 1% (100 basis points)
    uint256 public constant FEE_DENOMINATOR = 10000; // Basis points

    // ─── State ───────────────────────────────────────────
    address public executor;

    /// Swap fee: 15 basis points = 0.15%, deducted from amountOut
    uint256 public feeRate = 15;

    /// Address that accumulates swap fees (can withdraw via withdraw())
    address public feeCollector;

    /// user => token => balance
    mapping(address => mapping(address => uint256)) public balances;

    /// SC1: Whitelisted swap targets (DEX aggregator contracts)
    mapping(address => bool) public allowedSwapTargets;

    /// SC8: Per-user pause (owner can freeze individual accounts)
    mapping(address => bool) public userPaused;

    // ─── Events ──────────────────────────────────────────
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event Rebalance(
        address indexed user,
        address fromToken,
        address toToken,
        uint256 amountIn,
        uint256 amountOut
    );
    event FeeCollected(address indexed token, uint256 amount);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event SwapTargetUpdated(address indexed target, bool allowed);
    event UserPauseUpdated(address indexed user, bool paused);

    // ─── Errors ──────────────────────────────────────────
    error OnlyExecutor();
    error InsufficientBalance();
    error InvalidAmount();
    error SwapFailed();
    error SlippageExceeded();
    error ZeroAddress();
    error SwapTargetNotAllowed();     // SC1
    error InvalidSwapTarget();        // SC2
    error SameToken();                // SC5
    error NotAContract();             // SC10
    error UserIsPaused();             // SC8
    error FeeTooHigh();               // Fee > MAX_FEE_RATE

    // ─── Constructor ─────────────────────────────────────
    constructor(address _executor) Ownable(msg.sender) {
        if (_executor == address(0)) revert ZeroAddress();
        executor = _executor;
        feeCollector = msg.sender; // Owner collects fees by default
    }

    // ─── Modifiers ───────────────────────────────────────
    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ─── Admin functions ─────────────────────────────────

    /// @notice Update executor address
    function setExecutor(address _executor) external onlyOwner {
        if (_executor == address(0)) revert ZeroAddress();
        address old = executor;
        executor = _executor;
        emit ExecutorUpdated(old, _executor);
    }

    /// @notice SC1: Add or remove a swap target from the whitelist
    function setSwapTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedSwapTargets[target] = allowed;
        emit SwapTargetUpdated(target, allowed);
    }

    /// @notice SC6: Pause all vault operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice SC6: Unpause all vault operations
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice SC8: Pause/unpause a specific user's account
    function setUserPaused(address user, bool paused) external onlyOwner {
        if (user == address(0)) revert ZeroAddress();
        userPaused[user] = paused;
        emit UserPauseUpdated(user, paused);
    }

    /// @notice Update swap fee rate (in basis points, max 1%)
    function setFeeRate(uint256 _feeRate) external onlyOwner {
        if (_feeRate > MAX_FEE_RATE) revert FeeTooHigh();
        uint256 old = feeRate;
        feeRate = _feeRate;
        emit FeeRateUpdated(old, _feeRate);
    }

    /// @notice Update fee collector address
    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert ZeroAddress();
        address old = feeCollector;
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(old, _feeCollector);
    }

    // ─── User functions ──────────────────────────────────

    /// @notice Deposit tokens for rebalancing
    /// @dev SC11: Uses balanceOf delta to handle fee-on-transfer tokens
    function deposit(address token, uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        // SC9: zero address check
        if (token == address(0)) revert ZeroAddress();
        // SC10: verify token is a contract
        if (token.code.length == 0) revert NotAContract();

        // SC11: measure actual received amount (fee-on-transfer protection)
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;

        balances[msg.sender][token] += received;
        emit Deposit(msg.sender, token, received);
    }

    /// @notice Withdraw tokens
    /// @dev SC3: Protected by nonReentrant
    function withdraw(address token, uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        // SC9: zero address check
        if (token == address(0)) revert ZeroAddress();

        uint256 bal = balances[msg.sender][token];
        if (bal < amount) revert InsufficientBalance();
        balances[msg.sender][token] = bal - amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, token, amount);
    }

    /// @notice Execute rebalance via a whitelisted DEX aggregator
    /// @param user         User whose vault balance to rebalance
    /// @param fromToken    Token to sell
    /// @param toToken      Token to buy
    /// @param amount       Amount of fromToken to swap
    /// @param swapTarget   DEX aggregator contract (must be whitelisted)
    /// @param swapCalldata Encoded swap calldata from the aggregator API
    /// @param amountOutMin Minimum toToken to receive (slippage protection)
    function executeRebalance(
        address user,
        address fromToken,
        address toToken,
        uint256 amount,
        address swapTarget,
        bytes calldata swapCalldata,
        uint256 amountOutMin
    ) external onlyExecutor whenNotPaused nonReentrant returns (uint256 amountOut) {
        // ─── Validation ──────────────────────────────
        if (amount == 0) revert InvalidAmount();
        // SC9: zero address checks
        if (user == address(0)) revert ZeroAddress();
        if (fromToken == address(0) || toToken == address(0)) revert ZeroAddress();
        if (swapTarget == address(0)) revert ZeroAddress();
        // SC5: tokens must differ
        if (fromToken == toToken) revert SameToken();
        // SC1: swap target must be whitelisted
        if (!allowedSwapTargets[swapTarget]) revert SwapTargetNotAllowed();
        // SC2: swap target must not be a token or this contract
        if (swapTarget == fromToken || swapTarget == toToken || swapTarget == address(this)) {
            revert InvalidSwapTarget();
        }
        // SC8: user must not be paused
        if (userPaused[user]) revert UserIsPaused();

        uint256 bal = balances[user][fromToken];
        if (bal < amount) revert InsufficientBalance();

        // Deduct from user's vault balance
        balances[user][fromToken] = bal - amount;

        // SC4: Record fromToken balance before swap to detect partial fills
        uint256 fromTokenBefore = IERC20(fromToken).balanceOf(address(this));

        // Approve the DEX aggregator to spend fromToken
        IERC20(fromToken).forceApprove(swapTarget, amount);

        // Execute swap via aggregator
        uint256 toTokenBefore = IERC20(toToken).balanceOf(address(this));
        (bool success, ) = swapTarget.call(swapCalldata);
        if (!success) revert SwapFailed();

        amountOut = IERC20(toToken).balanceOf(address(this)) - toTokenBefore;

        // Slippage check
        if (amountOut < amountOutMin) revert SlippageExceeded();

        // SC4: Handle partial fills — return unspent fromToken to user's balance
        uint256 fromTokenAfter = IERC20(fromToken).balanceOf(address(this));
        uint256 actualSpent = fromTokenBefore - fromTokenAfter;
        if (actualSpent < amount) {
            // Aggregator didn't use all tokens — return the remainder
            balances[user][fromToken] += (amount - actualSpent);
        }

        // Deduct fee and credit the rest to user
        uint256 fee = 0;
        if (feeRate > 0 && feeCollector != address(0)) {
            fee = (amountOut * feeRate) / FEE_DENOMINATOR;
            balances[feeCollector][toToken] += fee;
            emit FeeCollected(toToken, fee);
        }
        balances[user][toToken] += (amountOut - fee);

        // Reset approval for safety
        IERC20(fromToken).forceApprove(swapTarget, 0);

        emit Rebalance(user, fromToken, toToken, amount, amountOut - fee);
    }

    // ─── SC13: ETH Recovery ──────────────────────────────

    /// @notice Recover accidentally sent ETH
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert InvalidAmount();
        (bool sent, ) = payable(owner()).call{value: balance}("");
        require(sent, "ETH transfer failed");
    }

    /// @notice Allow receiving ETH (for recovery purposes)
    receive() external payable {}
}
