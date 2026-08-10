// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AgentVault} from "./AgentVault.sol";

/// @title AgentVaultFactory — deploys per-user AgentVaults (SKELETON, UNAUDITED)
/// @notice Deliberately thin: it only mints vaults and keeps a registry. All shared
///         configuration (operator, router whitelist, oracles, fee, pause) is read
///         from the existing RebalancerFactory, so agent vaults inherit the same
///         audited-in-place oracle bounds instead of duplicating that surface.
contract AgentVaultFactory {
    address public immutable implementation;
    /// The RebalancerFactory whose routers/oracles/fee config agent vaults follow.
    address public immutable configFactory;

    mapping(address => address) public vaultOf; // user => agent vault
    address[] public allVaults;

    event AgentVaultDeployed(address indexed user, address indexed vault);

    error VaultExists();
    error ZeroAddress();

    constructor(address _configFactory) {
        if (_configFactory == address(0)) revert ZeroAddress();
        configFactory = _configFactory;
        implementation = address(new AgentVault());
    }

    /// @notice Deploy the caller's agent vault (one per address).
    function deployAgentVault() external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert VaultExists();
        vault = Clones.clone(implementation);
        // Checks-effects-interactions: record before the external initialize call.
        vaultOf[msg.sender] = vault;
        allVaults.push(vault);
        emit AgentVaultDeployed(msg.sender, vault);
        AgentVault(vault).initialize(msg.sender, configFactory);
    }

    function vaultsCount() external view returns (uint256) {
        return allVaults.length;
    }
}
