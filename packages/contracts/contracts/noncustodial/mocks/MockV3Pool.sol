// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Uniswap-V3 pool mock: reports a constant `tick` so that the
/// arithmetic-mean tick over any window equals `tick` (cumulative = tick * t).
contract MockV3Pool {
    address public token0;
    address public token1;
    int24 public tick;
    uint256 internal constant BASE = 1_000_000;

    constructor(address _token0, address _token1, int24 _tick) {
        token0 = _token0;
        token1 = _token1;
        tick = _tick;
    }

    function setTick(int24 _tick) external {
        tick = _tick;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128 = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            // cumulative(at time t) = tick * t, with t = BASE - secondsAgo
            tickCumulatives[i] = int56(tick) * int56(uint56(BASE - secondsAgos[i]));
        }
    }
}
