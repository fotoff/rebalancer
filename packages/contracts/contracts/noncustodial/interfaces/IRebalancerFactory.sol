// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The slice of the factory that a UserVault needs to read at runtime.
/// @dev Centralising operator/router/oracle config in the factory lets the protocol
///      rotate the executor or add price feeds without redeploying every user's vault.
///      It does NOT give the factory custody: the vault only ever sends swap output to
///      itself, and `getMinOut` (oracle-derived) caps the loss the operator can cause.
interface IRebalancerFactory {
    /// @notice Current trusted executor (our server bot). May be rotated by protocol admin.
    function operator() external view returns (address);

    /// @notice Whitelisted DEX routers/aggregators the vault is allowed to call.
    function isRouterAllowed(address router) external view returns (bool);

    /// @notice Global kill-switch. When true, operator rebalances are blocked
    ///         (user deposits/withdrawals are NEVER blocked — see UserVault).
    function paused() external view returns (bool);

    /// @notice Protocol fee in basis points, taken from swap output. Hard-capped on-chain.
    function feeRate() external view returns (uint256);

    /// @notice Address that receives protocol fees.
    function feeCollector() external view returns (address);

    /// @notice Upper bound on the slippage a user may configure per pair (defence in depth).
    function maxSlippageCeilingBps() external view returns (uint16);

    /// @notice Oracle-derived minimum acceptable output for a swap.
    /// @dev Computed from Chainlink feeds for `from`/`to` minus `maxSlippageBps`.
    ///      This is what makes the operator unable to swap at a bad price.
    function getMinOut(
        address from,
        address to,
        uint256 amountIn,
        uint16 maxSlippageBps
    ) external view returns (uint256 minOut);

    /// @notice Whether the pair can be priced on-chain (Chainlink feeds or a TWAP pool).
    function hasOracle(address from, address to) external view returns (bool);
}
