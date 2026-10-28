// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice TESTING ONLY. Deploys a MockUSDC for local/anvil runs; never use for Arc testnet/production.
/// Then run Deploy.s.sol with USDC_ADDRESS set to the printed address.
contract DeployMock is Script {
    function run() external {
        vm.startBroadcast();
        MockUSDC m = new MockUSDC();
        vm.stopBroadcast();
        console.log("MockUSDC", address(m));
    }
}
