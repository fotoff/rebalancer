// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @dev Test-only DEX router. Pulls `amountIn` of `from` via the caller's approval and
///      mints `amountOut` of `to` to `recipient`. The recipient/amountOut are caller-chosen
///      so tests can simulate an honest swap, a bad-price swap, or an output-stealing swap.
contract MockRouter {
    function swap(
        address from,
        address to,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) external {
        IERC20(from).transferFrom(msg.sender, address(this), amountIn);
        IMintable(to).mint(recipient, amountOut);
    }
}
