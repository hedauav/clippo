// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClippoEscrow} from "../src/ClippoEscrow.sol";
import {ClippoReportReceiver, IReceiver} from "../src/ClippoReportReceiver.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Workflow-identity validation in ClippoReportReceiver.onReport (metadata from the KeystoneForwarder).
contract ClippoReportReceiverTest is Test {
    ClippoEscrow escrow;
    ClippoReportReceiver receiver;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address forwarder = makeAddr("forwarder");
    address campaigner = makeAddr("campaigner");
    address alice = makeAddr("alice");
    address eve = makeAddr("eve");
    address wfOwner = makeAddr("wfOwner");
    address otherOwner = makeAddr("otherOwner");

    bytes32 constant WF_ID = keccak256("clippo-settlement");
    bytes10 constant WF_NAME = bytes10(0x62373666336165316465);
    uint256 id;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ClippoEscrow(address(usdc), treasury, owner);
        receiver = new ClippoReportReceiver(address(escrow), forwarder, owner, wfOwner, false);
        vm.startPrank(owner);
        escrow.setAdmin(admin, true);
        escrow.setReportAdapter(address(receiver));
        escrow.setHighValueThreshold(type(uint256).max);
        vm.stopPrank();

        usdc.mint(campaigner, 10_000e6);
        vm.startPrank(campaigner);
        usdc.approve(address(escrow), type(uint256).max);
        id = escrow.createCampaign(
            ClippoEscrow.Mode.PerView, 10e6, 1_000e6, uint64(block.timestamp + 30 days), false, "ipfs://x"
        );
        vm.stopPrank();
        vm.prank(admin);
        escrow.approveCampaign(id);
    }

    function _meta(bytes32 wid, bytes10 name, address wo) internal pure returns (bytes memory) {
        // production forwarder layout: 62 packed bytes + 2-byte reportId = 64 bytes
        return abi.encodePacked(wid, name, wo, bytes2(0x0001));
    }

    function _report(uint256 views) internal view returns (bytes memory) {
        ClippoReportReceiver.ViewReport[] memory items = new ClippoReportReceiver.ViewReport[](1);
        items[0] = ClippoReportReceiver.ViewReport(id, alice, views);
        return abi.encode(items);
    }

    function _send(bytes memory meta, uint256 views) internal {
        vm.prank(forwarder);
        receiver.onReport(meta, _report(views));
    }

    function test_correctOwnerPasses() public {
        _send(_meta(WF_ID, WF_NAME, wfOwner), 1000);
        assertEq(escrow.reportedViews(id, alice), 1000);
    }

    function test_wrongSender_reverts() public {
        bytes memory meta = _meta(WF_ID, WF_NAME, wfOwner);
        bytes memory rep = _report(1000);
        vm.prank(eve);
        vm.expectRevert(ClippoReportReceiver.NotForwarder.selector);
        receiver.onReport(meta, rep);
    }

    function test_wrongOwner_reverts() public {
        bytes memory meta = _meta(WF_ID, WF_NAME, otherOwner);
        bytes memory rep = _report(1000);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ClippoReportReceiver.InvalidWorkflowOwner.selector, otherOwner, wfOwner));
        receiver.onReport(meta, rep);
        assertEq(escrow.reportedViews(id, alice), 0);
    }

    function test_shortOrEmptyMetadata_reverts() public {
        bytes memory rep = _report(1000);
        vm.prank(forwarder);
        vm.expectRevert(ClippoReportReceiver.BadMetadata.selector);
        receiver.onReport("", rep);
        vm.prank(forwarder);
        vm.expectRevert(ClippoReportReceiver.BadMetadata.selector);
        receiver.onReport(new bytes(61), rep);
    }

    function test_exact62ByteMetadataAccepted() public {
        _send(abi.encodePacked(WF_ID, WF_NAME, wfOwner), 1000);
        assertEq(escrow.reportedViews(id, alice), 1000);
    }

    function test_wrongWorkflowId_reverts() public {
        vm.prank(owner);
        receiver.setExpectedWorkflowId(WF_ID);
        _send(_meta(WF_ID, WF_NAME, wfOwner), 1000); // matches
        bytes32 bad = keccak256("other");
        bytes memory meta = _meta(bad, WF_NAME, wfOwner);
        bytes memory rep = _report(2000);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ClippoReportReceiver.InvalidWorkflowId.selector, bad, WF_ID));
        receiver.onReport(meta, rep);
    }

    function test_wrongWorkflowName_reverts() public {
        vm.prank(owner);
        receiver.setExpectedWorkflowName(WF_NAME);
        _send(_meta(WF_ID, WF_NAME, wfOwner), 1000); // matches
        bytes10 bad = bytes10(0x01020304050607080910);
        bytes memory meta = _meta(WF_ID, bad, wfOwner);
        bytes memory rep = _report(2000);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ClippoReportReceiver.InvalidWorkflowName.selector, bad, WF_NAME));
        receiver.onReport(meta, rep);
    }

    function test_idAndNameOptionalWhenUnset() public {
        _send(_meta(keccak256("anything"), bytes10(0x01020304050607080910), wfOwner), 1000);
        assertEq(escrow.reportedViews(id, alice), 1000);
    }

    function test_correctNameWrongOwner_reverts() public {
        vm.prank(owner);
        receiver.setExpectedWorkflowName(WF_NAME);
        bytes memory meta = _meta(WF_ID, WF_NAME, otherOwner);
        bytes memory rep = _report(1000);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ClippoReportReceiver.InvalidWorkflowOwner.selector, otherOwner, wfOwner));
        receiver.onReport(meta, rep);
    }

    function test_unsetConfig_failsClosed() public {
        ClippoReportReceiver r = new ClippoReportReceiver(address(escrow), forwarder, owner, address(0), false);
        bytes memory rep = _report(1000);
        bytes memory meta = _meta(WF_ID, WF_NAME, wfOwner);
        vm.prank(forwarder);
        vm.expectRevert(ClippoReportReceiver.WorkflowOwnerNotConfigured.selector);
        r.onReport(meta, rep);
        // attacker-chosen metadata owner of address(0) must not match an unset owner
        bytes memory zeroOwner = _meta(WF_ID, WF_NAME, address(0));
        vm.prank(forwarder);
        vm.expectRevert(ClippoReportReceiver.WorkflowOwnerNotConfigured.selector);
        r.onReport(zeroOwner, rep);
        // clearing the owner on a configured receiver fails closed again
        vm.prank(owner);
        receiver.setExpectedWorkflowOwner(address(0));
        vm.prank(forwarder);
        vm.expectRevert(ClippoReportReceiver.WorkflowOwnerNotConfigured.selector);
        receiver.onReport(meta, rep);
    }

    function test_skipFlag_allowsEmptyMetadata_butNotWrongSender() public {
        ClippoReportReceiver r = new ClippoReportReceiver(address(escrow), forwarder, owner, address(0), true);
        assertTrue(r.workflowCheckSkipped());
        vm.prank(owner);
        escrow.setReportAdapter(address(r));
        bytes memory rep = _report(1000);
        vm.prank(forwarder);
        r.onReport("", rep);
        assertEq(escrow.reportedViews(id, alice), 1000);
        vm.prank(eve);
        vm.expectRevert(ClippoReportReceiver.NotForwarder.selector);
        r.onReport("", rep);
        // switching the flag off re-enables the (unset => fail closed) check
        vm.prank(owner);
        r.setWorkflowCheckSkipped(false);
        vm.prank(forwarder);
        vm.expectRevert(ClippoReportReceiver.WorkflowOwnerNotConfigured.selector);
        r.onReport("", rep);
    }

    function test_configOnlyOwner() public {
        bytes memory e = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, eve);
        vm.startPrank(eve);
        vm.expectRevert(e);
        receiver.setForwarder(eve);
        vm.expectRevert(e);
        receiver.setExpectedWorkflowOwner(eve);
        vm.expectRevert(e);
        receiver.setExpectedWorkflowId(WF_ID);
        vm.expectRevert(e);
        receiver.setExpectedWorkflowName(WF_NAME);
        vm.expectRevert(e);
        receiver.setWorkflowCheckSkipped(true);
        vm.stopPrank();
    }

    function test_configChangesEmitEvents() public {
        vm.startPrank(owner);
        vm.expectEmit(true, false, false, false);
        emit ClippoReportReceiver.ForwarderSet(eve);
        receiver.setForwarder(eve);
        vm.expectEmit(true, true, false, false);
        emit ClippoReportReceiver.ExpectedWorkflowOwnerSet(wfOwner, otherOwner);
        receiver.setExpectedWorkflowOwner(otherOwner);
        vm.expectEmit(true, true, false, false);
        emit ClippoReportReceiver.ExpectedWorkflowIdSet(bytes32(0), WF_ID);
        receiver.setExpectedWorkflowId(WF_ID);
        vm.expectEmit(true, true, false, false);
        emit ClippoReportReceiver.ExpectedWorkflowNameSet(bytes10(0), WF_NAME);
        receiver.setExpectedWorkflowName(WF_NAME);
        vm.expectEmit(false, false, false, true);
        emit ClippoReportReceiver.WorkflowCheckSkippedSet(true);
        receiver.setWorkflowCheckSkipped(true);
        vm.stopPrank();
        assertEq(receiver.forwarder(), eve);
        assertEq(receiver.expectedWorkflowOwner(), otherOwner);
    }

    function test_ownerCanRotateExpectedOwner() public {
        vm.prank(owner);
        receiver.setExpectedWorkflowOwner(otherOwner);
        _send(_meta(WF_ID, WF_NAME, otherOwner), 1000);
        bytes memory meta = _meta(WF_ID, WF_NAME, wfOwner);
        bytes memory rep = _report(2000);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ClippoReportReceiver.InvalidWorkflowOwner.selector, wfOwner, otherOwner));
        receiver.onReport(meta, rep);
    }

    function test_replayStaysSafe() public {
        bytes memory meta = _meta(WF_ID, WF_NAME, wfOwner);
        _send(meta, 1000);
        uint256 credited = escrow.credited(id, alice);
        assertGt(credited, 0);
        _send(meta, 1000); // identical replay: no extra credit
        assertEq(escrow.credited(id, alice), credited);
        _send(meta, 500); // stale (lower cumulative): no extra credit, no revert
        assertEq(escrow.credited(id, alice), credited);
        assertEq(escrow.reportedViews(id, alice), 1000);
    }

    function test_itemFailedStillSkipped() public {
        ClippoReportReceiver.ViewReport[] memory items = new ClippoReportReceiver.ViewReport[](2);
        items[0] = ClippoReportReceiver.ViewReport(9999, alice, 1000); // unknown campaign
        items[1] = ClippoReportReceiver.ViewReport(id, alice, 1000);
        bytes memory meta = _meta(WF_ID, WF_NAME, wfOwner);
        vm.expectEmit(false, false, false, true);
        emit ClippoReportReceiver.ReportProcessed(2, 1);
        vm.prank(forwarder);
        receiver.onReport(meta, abi.encode(items));
        assertEq(escrow.reportedViews(id, alice), 1000);
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(0xffffffff));
    }
}
