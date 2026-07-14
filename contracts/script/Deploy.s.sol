// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LaunchProofRegistry} from "../src/LaunchProofRegistry.sol";

interface Vm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (LaunchProofRegistry registry) {
        address writer = vm.envAddress("REGISTRY_WRITER_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        registry = new LaunchProofRegistry(writer);
        vm.stopBroadcast();
    }
}
