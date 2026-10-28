// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract DeployTest is Test {
    address admin = makeAddr("admin");
    address fwd = makeAddr("fwd");
    address upd = makeAddr("upd");
    address wfOwner = makeAddr("wfOwner");

    function _env() internal {
        vm.setEnv("ADMIN_ADDRESS", vm.toString(admin));
        vm.setEnv("FORWARDER_ADDRESS", vm.toString(fwd));
        vm.setEnv("UPDATER_ADDRESS", vm.toString(upd));
        vm.setEnv("EXPECTED_WORKFLOW_OWNER", vm.toString(wfOwner));
        vm.setEnv("EXPECTED_WORKFLOW_ID", vm.toString(bytes32(uint256(0xabc))));
        vm.setEnv("EXPECTED_WORKFLOW_NAME", "0x62373666336165316465");
        vm.setEnv("INSECURE_SKIP_WORKFLOW_CHECK", "false");
    }

    function test_wiring() public {
        _env();
        vm.chainId(5042002);
        // Arc USDC system contract: stand in with a 6-decimal token at the official address.
        vm.etch(0x3600000000000000000000000000000000000000, address(new MockUSDC()).code);
        Deploy d = new Deploy();
        d.run();
        assertEq(d.usdc(), 0x3600000000000000000000000000000000000000);
        assertEq(address(d.escrow().usdc()), d.usdc());
        assertEq(d.escrow().reportAdapter(), address(d.receiver()));
        assertEq(d.receiver().forwarder(), fwd);
        assertEq(d.receiver().expectedWorkflowOwner(), wfOwner);
        assertEq(d.receiver().expectedWorkflowId(), bytes32(uint256(0xabc)));
        assertEq(d.receiver().expectedWorkflowName(), bytes10(0x62373666336165316465));
        assertFalse(d.receiver().workflowCheckSkipped());
        assertEq(address(d.receiver().escrow()), address(d.escrow()));
        assertTrue(d.escrow().isAdmin(admin));
        assertEq(d.escrow().owner(), admin);
        assertEq(d.receiver().owner(), admin);
        assertEq(d.referral().owner(), admin);
        assertEq(d.profile().owner(), admin);
        assertTrue(d.profile().updaters(upd));
        assertTrue(d.referral().recorders(upd));
        assertTrue(d.referral().guardians(admin));
        assertEq(d.escrow().treasury(), admin);
        assertEq(d.escrow().campaignerFeeBps(), 25);
        assertEq(d.escrow().retentionPeriod(), 7 days);
        assertEq(d.escrow().highValueThreshold(), 1_000e6);
        assertEq(d.deployBlock(), block.number);

        // env is process-global, so the negative cases run in the same test
        // unset workflow owner without the explicit skip flag: deploy must refuse (fail closed)
        vm.setEnv("EXPECTED_WORKFLOW_OWNER", "0x0000000000000000000000000000000000000000");
        Deploy d3 = new Deploy();
        vm.expectRevert();
        d3.run();
        // explicit simulation flag: allowed, receiver skips metadata
        vm.setEnv("INSECURE_SKIP_WORKFLOW_CHECK", "true");
        Deploy d4 = new Deploy();
        d4.run();
        assertTrue(d4.receiver().workflowCheckSkipped());
        assertEq(d4.receiver().expectedWorkflowOwner(), address(0));
        vm.setEnv("INSECURE_SKIP_WORKFLOW_CHECK", "false");
        vm.setEnv("EXPECTED_WORKFLOW_OWNER", vm.toString(wfOwner));
        vm.setEnv("FORWARDER_ADDRESS", "0x0000000000000000000000000000000000000000");
        Deploy d2 = new Deploy();
        vm.expectRevert(bytes("Deploy: missing required env FORWARDER_ADDRESS"));
        d2.run();
    }
}
