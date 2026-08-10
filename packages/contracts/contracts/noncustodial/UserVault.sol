// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IRebalancerFactory} from "./interfaces/IRebalancerFactory.sol";

/// @title UserVault — non-custodial per-user rebalancing vault (SKELETON, UNAUDITED)
/// @notice One vault per user, deployed as a minimal-proxy clone by RebalancerFactory.
///         The vault's own token balance IS the user's balance — no shared accounting.
///
/// Guarantees by construction:
///   (a) No custody for the service. The operator can ONLY call {rebalance}, and only
///       within pairs the user explicitly allowed, only above the oracle-derived min-out.
///   (b) Funds can't be extracted. Only the `owner` (the user) can {withdraw}. The swap
///       output of {rebalance} is measured on THIS vault — routing it elsewhere reverts.
///   (c) Bounded loss per swap. {rebalance} reverts unless received >= oracle price minus
///       the user's configured maxSlippage, so the operator can't dump at a bad rate.
///
/// @dev SKELETON: integrate-test, fuzz, and get a professional audit before mainnet.
///      Known TODOs are marked inline.
contract UserVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────
    IRebalancerFactory public factory;
    address public owner; // the user

    struct PairPolicy {
        bool allowed;
        uint16 maxSlippageBps; // e.g. 100 = 1%; bounded by factory.maxSlippageCeilingBps()
        uint32 cooldown;       // min seconds between rebalances of this pair (anti-churn)
        uint64 lastExec;       // timestamp of last rebalance
        // When true AND the factory has no oracle for this pair, the operator may
        // supply the min-out (from the aggregator quote), like the old custodial
        // model. The user explicitly accepts trusting the operator for THIS pair.
        bool trustOperatorMinOut;
    }

    /// @dev key = keccak256(from, to). Direction-specific by design.
    mapping(bytes32 => PairPolicy) public pairPolicy;

    // ─── Events ──────────────────────────────────────────
    event Initialized(address indexed owner, address indexed factory);
    event PairPolicySet(address indexed from, address indexed to, bool allowed, uint16 maxSlippageBps, uint32 cooldown, bool trustOperatorMinOut);
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event Rebalanced(address indexed from, address indexed to, uint256 amountIn, uint256 netOut, uint256 fee);

    // ─── Errors ──────────────────────────────────────────
    error NotOwner();
    error NotOperator();
    error ZeroAddress();
    error SameToken();
    error SlippageTooHigh();
    error PairNotAllowed();
    error CooldownActive();
    error RouterNotAllowed();
    error ProtocolPaused();
    error BadAmount();
    error SwapFailed();
    error SlippageExceeded();
    error NoOracle();

    // ─── Modifiers ───────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != factory.operator()) revert NotOperator();
        _;
    }

    // ─── Init ────────────────────────────────────────────
    constructor() {
        // Lock the implementation so it can't be initialised/hijacked directly.
        _disableInitializers();
    }

    /// @notice Called once by the factory right after cloning.
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

    /// @notice Pull `amount` of `token` from the caller into the vault.
    /// @dev Anyone may fund the vault — only the owner can ever withdraw, so funding
    ///      it is harmless. Tokens can also just be transferred to the vault directly.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert BadAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    /// @notice EIP-2612 single-transaction deposit: permit + pull, no separate approve.
    /// @dev Works with B20 tokens (native permit) and any ERC-2612 ERC-20. The permit
    ///      call is wrapped in try/catch so a front-run permit can't grief the deposit.
    function depositWithPermit(
        address token,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (amount == 0) revert BadAmount();
        try IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    // ─── User functions (onlyOwner) ──────────────────────

    /// @notice Allow/deny a directional pair the operator may rebalance, with its own
    ///         slippage tolerance and cooldown. The user is in full control of this list.
    function setPairPolicy(
        address from,
        address to,
        bool allowed,
        uint16 maxSlippageBps,
        uint32 cooldown,
        bool trustOperatorMinOut
    ) external onlyOwner {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (from == to) revert SameToken();
        if (maxSlippageBps > factory.maxSlippageCeilingBps()) revert SlippageTooHigh();

        PairPolicy storage p = pairPolicy[_key(from, to)];
        p.allowed = allowed;
        p.maxSlippageBps = maxSlippageBps;
        p.cooldown = cooldown;
        p.trustOperatorMinOut = trustOperatorMinOut;
        // lastExec intentionally preserved across edits.
        emit PairPolicySet(from, to, allowed, maxSlippageBps, cooldown, trustOperatorMinOut);
    }

    /// @notice Withdraw tokens. Always available — NOT gated by any pause. Only the user.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert BadAmount();
        IERC20(token).safeTransfer(owner, amount);
        emit Withdrawn(token, owner, amount);
    }

    /// @notice Withdraw the full balance of a token (convenience / emergency exit).
    function withdrawAll(address token) external onlyOwner nonReentrant {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert BadAmount();
        IERC20(token).safeTransfer(owner, bal);
        emit Withdrawn(token, owner, bal);
    }

    /// @notice Hand the vault to a new owner (e.g. migrating wallets).
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─── Operator function ───────────────────────────────

    /// @notice Execute one rebalance within the user's policy. Callable only by the
    ///         current factory operator. Cannot move funds out of the vault, cannot
    ///         touch a pair the user didn't allow, cannot accept a bad price.
    /// @param from      token to sell (must have allowed policy for from->to)
    /// @param to        token to buy
    /// @param amountIn  amount of `from` to swap
    /// @param router       whitelisted DEX router/aggregator
    /// @param swapData     encoded calldata from the aggregator API (output MUST land here)
    /// @param operatorMinOut min-out the operator claims (from the aggregator quote). Only
    ///        honoured for pairs the user flagged `trustOperatorMinOut` AND that have no
    ///        oracle. When an oracle exists, the stricter of (oracle, operator) is enforced.
    function rebalance(
        address from,
        address to,
        uint256 amountIn,
        address router,
        bytes calldata swapData,
        uint256 operatorMinOut
    ) external onlyOperator nonReentrant returns (uint256 received) {
        if (factory.paused()) revert ProtocolPaused();

        PairPolicy storage p = pairPolicy[_key(from, to)];
        if (!p.allowed) revert PairNotAllowed();
        if (block.timestamp < uint256(p.lastExec) + p.cooldown) revert CooldownActive();
        if (!factory.isRouterAllowed(router)) revert RouterNotAllowed();
        if (amountIn == 0 || amountIn > IERC20(from).balanceOf(address(this))) revert BadAmount();

        // Floor preference: ORACLE when configured. If an oracle exists, getMinOut is
        // called directly so a STALE/bad oracle hard-reverts (never silently downgrades
        // to trusted mode). Only pairs with no oracle at all may use the operator's quote.
        uint256 minOut;
        if (factory.hasOracle(from, to)) {
            uint256 oracleMin = factory.getMinOut(from, to, amountIn, p.maxSlippageBps);
            minOut = oracleMin > operatorMinOut ? oracleMin : operatorMinOut;
        } else {
            if (!p.trustOperatorMinOut) revert NoOracle();
            if (operatorMinOut == 0) revert BadAmount();
            minOut = operatorMinOut;
        }

        uint256 toBefore = IERC20(to).balanceOf(address(this));

        IERC20(from).forceApprove(router, amountIn);
        (bool ok, ) = router.call(swapData);
        IERC20(from).forceApprove(router, 0); // reset regardless of partial spend
        if (!ok) revert SwapFailed();

        // Output is measured on THIS contract. If swapData routed funds elsewhere,
        // `received` is 0 and we revert below — that's why arbitrary calldata is safe here.
        received = IERC20(to).balanceOf(address(this)) - toBefore;
        if (received < minOut) revert SlippageExceeded();

        // Mark cooldown before external transfer (no untrusted reentry path, but cheap safety).
        p.lastExec = uint64(block.timestamp);

        // Protocol fee from output (hard-capped in the factory). Stays as `to` tokens.
        uint256 fee = (received * factory.feeRate()) / 10000;
        if (fee > 0) {
            IERC20(to).safeTransfer(factory.feeCollector(), fee);
        }

        emit Rebalanced(from, to, amountIn, received - fee, fee);
        // Net output and any unspent `from` simply remain in the vault — the user owns it.
    }
}
