// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Pull OpenZeppelin's TimelockController into compilation so the deploy script
// can deploy it as the factory's owner (delayed, public admin changes).
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
