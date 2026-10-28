// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClippoEscrow} from "../src/ClippoEscrow.sol";
import {ClippoReportReceiver} from "../src/ClippoReportReceiver.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract ClippoEscrowTest is Test {
    ClippoEscrow escrow;
    ClippoReportReceiver receiver;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address forwarder = makeAddr("forwarder");
    address campaigner = makeAddr("campaigner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address eve = makeAddr("eve");

    uint256 constant POOL = 10_000e6;
    uint256 constant FEE = 25e6; // 25 bps of POOL
    uint256 constant NET = POOL - FEE;
    uint64 deadline;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ClippoEscrow(address(usdc), treasury, owner);
        receiver = new ClippoReportReceiver(address(escrow), forwarder, owner, address(0), true); // escrow-logic tests skip workflow metadata; see ClippoReportReceiver.t.sol
        vm.startPrank(owner);
        escrow.setAdmin(admin, true);
        escrow.setReportAdapter(address(receiver));
        escrow.setHighValueThreshold(type(uint256).max); // legacy tests use $10k pools; high-value tests re-enable
        escrow.setRetentionPeriod(0); // legacy tests assume instant release; retention tests set their own window
        vm.stopPrank();
        deadline = uint64(block.timestamp + 30 days);
        usdc.mint(campaigner, 1_000_000e6);
        vm.prank(campaigner);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ---------------------------------------------------------- helpers
    function _create(ClippoEscrow.Mode mode, uint256 rate, bool second) internal returns (uint256 id) {
        vm.prank(campaigner);
        id = escrow.createCampaign(mode, rate, POOL, deadline, second, "ipfs://meta");
    }

    function _createApproved(ClippoEscrow.Mode mode, uint256 rate, bool second) internal returns (uint256 id) {
        id = _create(mode, rate, second);
        vm.prank(admin);
        escrow.approveCampaign(id);
    }

    function _report(uint256 id, address creator, uint256 views) internal {
        ClippoReportReceiver.ViewReport[] memory items = new ClippoReportReceiver.ViewReport[](1);
        items[0] = ClippoReportReceiver.ViewReport(id, creator, views);
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(items));
    }

    function _arr(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _arr2(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _u(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _u2(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    // -------------------------------------------------------- lifecycle
    function test_create_pullsFundsAndDeductsFee() public {
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        ClippoEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(id, 1);
        assertEq(c.campaigner, campaigner);
        assertEq(uint8(c.state), uint8(ClippoEscrow.State.Funded));
        assertEq(c.grossFunded, POOL);
        assertEq(c.campaignerFee, FEE);
        assertEq(c.pool, NET);
        assertEq(usdc.balanceOf(address(escrow)), POOL);
        assertEq(escrow.treasuryAccrued(), 0); // not accrued until approval
    }

    function test_create_invalidParams() public {
        vm.startPrank(campaigner);
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        escrow.createCampaign(ClippoEscrow.Mode.PerView, 5e6, 0, deadline, false, "");
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        escrow.createCampaign(ClippoEscrow.Mode.PerView, 5e6, POOL, uint64(block.timestamp), false, "");
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        escrow.createCampaign(ClippoEscrow.Mode.PerView, 0, POOL, deadline, false, "");
        vm.stopPrank();
    }

    function test_approve_accruesCampaignerFee() public {
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.prank(admin);
        escrow.approveCampaign(id);
        assertEq(uint8(escrow.getCampaign(id).state), uint8(ClippoEscrow.State.Approved));
        assertEq(escrow.treasuryAccrued(), FEE);
        escrow.withdrawFees();
        assertEq(usdc.balanceOf(treasury), FEE);
        assertEq(escrow.treasuryAccrued(), 0);
    }

    function test_reject_refundsInFullIncludingFee() public {
        uint256 before_ = usdc.balanceOf(campaigner);
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.prank(admin);
        escrow.rejectCampaign(id);
        assertEq(usdc.balanceOf(campaigner), before_);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.treasuryAccrued(), 0);
        assertEq(uint8(escrow.getCampaign(id).state), uint8(ClippoEscrow.State.Rejected));
        // terminal
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Rejected));
        escrow.approveCampaign(id);
    }

    function test_approveReject_onlyAdmin() public {
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.startPrank(eve);
        vm.expectRevert(ClippoEscrow.NotAdmin.selector);
        escrow.approveCampaign(id);
        vm.expectRevert(ClippoEscrow.NotAdmin.selector);
        escrow.rejectCampaign(id);
        vm.stopPrank();
        // campaigner can't self-approve
        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.NotAdmin.selector);
        escrow.approveCampaign(id);
    }

    function test_cannotApproveTwiceOrRejectApproved() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Approved));
        escrow.approveCampaign(id);
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Approved));
        escrow.rejectCampaign(id);
        vm.stopPrank();
    }

    function test_noEarningBeforeApproval() public {
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.prank(eve);
        vm.expectRevert(ClippoEscrow.NotAdapter.selector);
        escrow.reportViews(id, alice, 1000);

        // via adapter: item fails (campaign not approved), batch continues
        vm.expectEmit(true, true, false, false);
        emit ClippoReportReceiver.ItemFailed(id, alice, "");
        _report(id, alice, 1000);
        assertEq(escrow.claimable(id, alice), 0);
    }

    // ------------------------------------------------------ fee config
    function test_setFees_maxAndAccess() public {
        vm.prank(owner);
        vm.expectRevert(ClippoEscrow.FeeTooHigh.selector);
        escrow.setFees(51, 10);
        vm.prank(owner);
        vm.expectRevert(ClippoEscrow.FeeTooHigh.selector);
        escrow.setFees(10, 51);
        vm.prank(eve);
        vm.expectRevert();
        escrow.setFees(10, 10);
        vm.prank(owner);
        escrow.setFees(50, 10);
        assertEq(escrow.campaignerFeeBps(), 50);
        assertEq(escrow.creatorFeeBps(), 10);
    }

    function test_feeSnapshotPerCampaign() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 1e6, false);
        vm.prank(owner);
        escrow.setFees(50, 50);
        _report(id, alice, 1000); // 1 USDC at snapshot 25 bps creator fee
        vm.prank(alice);
        uint256 net = escrow.claim(id);
        assertEq(net, 1e6 - (1e6 * 25) / 10_000);
    }

    function test_zeroFees() public {
        vm.prank(owner);
        escrow.setFees(0, 0);
        uint256 id = _create(ClippoEscrow.Mode.PerView, 1e6, false);
        assertEq(escrow.getCampaign(id).pool, POOL);
    }

    function test_adminManagement_onlyOwner() public {
        vm.prank(eve);
        vm.expectRevert();
        escrow.setAdmin(eve, true);
        vm.prank(eve);
        vm.expectRevert();
        escrow.setReportAdapter(eve);
        vm.prank(eve);
        vm.expectRevert();
        escrow.setTreasury(eve);
    }

    // --------------------------------------------------------- PerView
    function test_perView_creditsDeltaOnly() public {
        // rate: 5 USDC per 1k views
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 10_000); // 50 USDC
        assertEq(escrow.claimable(id, alice), 50e6);
        _report(id, alice, 14_000); // +4000 -> +20 USDC
        assertEq(escrow.claimable(id, alice), 70e6);
        assertEq(escrow.reportedViews(id, alice), 14_000);
        assertEq(escrow.getCampaign(id).allocated, 70e6);
    }

    function test_perView_staleReportIsNoop() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 10_000);
        _report(id, alice, 10_000);
        _report(id, alice, 9_000);
        assertEq(escrow.claimable(id, alice), 50e6);
        assertEq(escrow.reportedViews(id, alice), 10_000);
    }

    function test_perView_cappedByRemainingPool() public {
        // 1000 USDC per 1k views; pool net 9975 -> cap
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 1000e6, false);
        _report(id, alice, 8_000); // 8000 USDC
        _report(id, bob, 5_000); // wants 5000, only 1975 left
        assertEq(escrow.claimable(id, alice), 8000e6);
        assertEq(escrow.claimable(id, bob), NET - 8000e6);
        assertEq(escrow.remainingPool(id), 0);
        _report(id, alice, 20_000); // pool exhausted
        assertEq(escrow.claimable(id, alice), 8000e6);
        assertEq(escrow.getCampaign(id).allocated, NET);
    }

    function test_perView_batchViaAdapterSkipsBadItems() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        uint256 id2 = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, false);
        ClippoReportReceiver.ViewReport[] memory items = new ClippoReportReceiver.ViewReport[](3);
        items[0] = ClippoReportReceiver.ViewReport(id, alice, 1000);
        items[1] = ClippoReportReceiver.ViewReport(id2, alice, 1000); // wrong mode
        items[2] = ClippoReportReceiver.ViewReport(id, bob, 2000);
        vm.expectEmit(false, false, false, true);
        emit ClippoReportReceiver.ReportProcessed(3, 1);
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(items));
        assertEq(escrow.claimable(id, alice), 5e6);
        assertEq(escrow.claimable(id, bob), 10e6);
    }

    function test_perView_wrongModeReverts() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PoolShare, 0, false);
        vm.prank(address(receiver));
        vm.expectRevert(ClippoEscrow.BadMode.selector);
        escrow.reportViews(id, alice, 100);
    }

    function test_perView_afterDeadlineReverts() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.warp(deadline + 1);
        vm.prank(address(receiver));
        vm.expectRevert(ClippoEscrow.DeadlinePassed.selector);
        escrow.reportViews(id, alice, 100);
    }

    function test_perView_onlyAdapterCanReport() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.startPrank(admin);
        vm.expectRevert(ClippoEscrow.NotAdapter.selector);
        escrow.reportViews(id, alice, 1000);
        vm.stopPrank();
        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.NotAdapter.selector);
        escrow.reportViews(id, alice, 1000);
    }

    function test_receiver_onlyForwarder() public {
        ClippoReportReceiver.ViewReport[] memory items = new ClippoReportReceiver.ViewReport[](0);
        vm.prank(eve);
        vm.expectRevert(ClippoReportReceiver.NotForwarder.selector);
        receiver.onReport("", abi.encode(items));
        vm.prank(eve);
        vm.expectRevert();
        receiver.setForwarder(eve);
        vm.prank(owner);
        receiver.setForwarder(eve);
        assertEq(receiver.forwarder(), eve);
    }

    function test_receiver_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(0x01ffc9a7)); // ERC165
        assertTrue(receiver.supportsInterface(type(IReceiverId).interfaceId));
        assertFalse(receiver.supportsInterface(0xffffffff));
    }

    // -------------------------------------------------- claim + fees
    function test_claim_creatorFeeMath_and_doubleClaim() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 10_000); // 50 USDC gross
        uint256 fee = (50e6 * 25) / 10_000; // 125000 = 0.125 USDC
        vm.prank(alice);
        uint256 net = escrow.claim(id);
        assertEq(net, 50e6 - fee);
        assertEq(usdc.balanceOf(alice), 50e6 - fee);
        assertEq(escrow.treasuryAccrued(), FEE + fee);

        vm.prank(alice);
        vm.expectRevert(ClippoEscrow.NothingToClaim.selector);
        escrow.claim(id);

        // new views later -> claim again only the new part
        _report(id, alice, 12_000);
        assertEq(escrow.claimable(id, alice), 10e6);
        vm.prank(alice);
        escrow.claim(id);
        assertEq(escrow.claimed(id, alice), 60e6);

        escrow.withdrawFees();
        assertEq(usdc.balanceOf(treasury), FEE + fee + (10e6 * 25) / 10_000);
    }

    function test_claim_nothingOrWrongState() public {
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Funded));
        escrow.claim(id);
        vm.prank(admin);
        escrow.approveCampaign(id);
        vm.prank(eve);
        vm.expectRevert(ClippoEscrow.NothingToClaim.selector);
        escrow.claim(id);
    }

    function test_withdrawFees_emptyReverts() public {
        vm.expectRevert(ClippoEscrow.NothingToClaim.selector);
        escrow.withdrawFees();
    }

    // ------------------------------------------------------ close
    function test_close_perView_refundsUnallocated() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 10_000); // 50 USDC
        uint256 before_ = usdc.balanceOf(campaigner);

        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.DeadlineNotReached.selector);
        escrow.closeCampaign(id);

        vm.warp(deadline + 1);
        vm.prank(campaigner);
        escrow.closeCampaign(id);
        assertEq(usdc.balanceOf(campaigner) - before_, NET - 50e6);
        assertEq(uint8(escrow.getCampaign(id).state), uint8(ClippoEscrow.State.Closed));

        // creator can still claim after close
        vm.prank(alice);
        escrow.claim(id);
        // escrow holds only the treasury fees now
        assertEq(usdc.balanceOf(address(escrow)), escrow.treasuryAccrued());

        // cannot close twice
        vm.prank(campaigner);
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Closed));
        escrow.closeCampaign(id);
    }

    function test_close_adminCanCloseEarly_strangerCannot() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.prank(eve);
        vm.expectRevert(ClippoEscrow.NotCampaigner.selector);
        escrow.closeCampaign(id);
        vm.prank(admin);
        escrow.closeCampaign(id);
        assertEq(uint8(escrow.getCampaign(id).state), uint8(ClippoEscrow.State.Closed));
    }

    function test_close_requiresApproved() public {
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Funded));
        escrow.closeCampaign(id);
    }

    function test_reportAfterClose_reverts() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        vm.prank(admin);
        escrow.closeCampaign(id);
        vm.prank(address(receiver));
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Closed));
        escrow.reportViews(id, alice, 1);
    }

    // ------------------------------------------------- HumanSplit
    function test_humanSplit_campaignerAlone() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, false);
        vm.prank(campaigner);
        escrow.approveSplit(id, _arr2(alice, bob), _u2(3000e6, 2000e6));
        assertEq(escrow.claimable(id, alice), 3000e6);
        assertEq(escrow.claimable(id, bob), 2000e6);
        assertEq(escrow.remainingPool(id), NET - 5000e6);

        // a second round within the remaining pool
        vm.prank(admin);
        escrow.approveSplit(id, _arr(alice), _u(1000e6));
        assertEq(escrow.claimable(id, alice), 4000e6);

        vm.prank(alice);
        escrow.claim(id);
        vm.prank(bob);
        escrow.claim(id);

        vm.warp(deadline + 1);
        uint256 before_ = usdc.balanceOf(campaigner);
        vm.prank(campaigner);
        escrow.closeCampaign(id);
        assertEq(usdc.balanceOf(campaigner) - before_, NET - 6000e6);
    }

    function test_humanSplit_sumExceedsPool() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, false);
        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.PoolExceeded.selector);
        escrow.approveSplit(id, _arr2(alice, bob), _u2(NET, 1));
        // exactly the pool is fine
        vm.prank(campaigner);
        escrow.approveSplit(id, _arr2(alice, bob), _u2(NET - 1, 1));
        assertEq(escrow.remainingPool(id), 0);
        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.PoolExceeded.selector);
        escrow.approveSplit(id, _arr(alice), _u(1));
    }

    function test_humanSplit_secondApproverRequired() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, true);
        address[] memory cs = _arr2(alice, bob);
        uint256[] memory amts = _u2(100e6, 200e6);

        vm.prank(campaigner);
        escrow.approveSplit(id, cs, amts);
        assertEq(escrow.claimable(id, alice), 0); // pending
        assertEq(escrow.remainingPool(id), NET);

        // different split from admin resets approvals
        vm.prank(admin);
        escrow.approveSplit(id, cs, _u2(100e6, 300e6));
        assertEq(escrow.claimable(id, alice), 0);

        // campaigner now matches the admin's version -> finalized
        vm.prank(campaigner);
        escrow.approveSplit(id, cs, _u2(100e6, 300e6));
        assertEq(escrow.claimable(id, alice), 100e6);
        assertEq(escrow.claimable(id, bob), 300e6);
        (bytes32 h,,) = escrow.pendingSplit(id);
        assertEq(h, bytes32(0));
    }

    function test_humanSplit_sameApproverTwiceDoesNotFinalize() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, true);
        vm.startPrank(campaigner);
        escrow.approveSplit(id, _arr(alice), _u(100e6));
        escrow.approveSplit(id, _arr(alice), _u(100e6));
        vm.stopPrank();
        assertEq(escrow.claimable(id, alice), 0);
    }

    function test_humanSplit_accessAndStateChecks() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, false);
        vm.prank(eve);
        vm.expectRevert(ClippoEscrow.NotApprover.selector);
        escrow.approveSplit(id, _arr(alice), _u(1));

        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        escrow.approveSplit(id, _arr(alice), _u2(1, 2)); // length mismatch

        uint256 pv = _createApproved(ClippoEscrow.Mode.PerView, 1e6, false);
        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.BadMode.selector);
        escrow.approveSplit(pv, _arr(alice), _u(1));

        uint256 funded = _create(ClippoEscrow.Mode.HumanSplit, 0, false);
        vm.prank(campaigner);
        vm.expectRevert(abi.encodeWithSelector(ClippoEscrow.BadState.selector, ClippoEscrow.State.Funded));
        escrow.approveSplit(funded, _arr(alice), _u(1));
    }

    // -------------------------------------------------- PoolShare
    function test_poolShare_proportionalAtClose() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PoolShare, 0, false);
        vm.prank(campaigner);
        escrow.setWeights(id, _arr2(alice, bob), _u2(3, 1));
        assertEq(escrow.totalWeight(id), 4);

        // nothing claimable before close
        assertEq(escrow.claimable(id, alice), 0);
        vm.prank(alice);
        vm.expectRevert(ClippoEscrow.NothingToClaim.selector);
        escrow.claim(id);

        // admin may re-set weights (replaces)
        vm.prank(admin);
        escrow.setWeights(id, _arr2(alice, bob), _u2(1, 1));

        vm.warp(deadline + 1);
        uint256 before_ = usdc.balanceOf(campaigner);
        vm.prank(campaigner);
        escrow.closeCampaign(id);
        uint256 half = NET / 2;
        assertEq(escrow.claimable(id, alice), half);
        assertEq(escrow.claimable(id, bob), half);
        // dust (NET is odd) is refunded to campaigner
        assertEq(usdc.balanceOf(campaigner) - before_, NET - 2 * half);

        vm.prank(alice);
        escrow.claim(id);
        vm.prank(bob);
        escrow.claim(id);
        assertEq(usdc.balanceOf(address(escrow)), escrow.treasuryAccrued());
    }

    function test_poolShare_noWeightsRefundsAll() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PoolShare, 0, false);
        uint256 before_ = usdc.balanceOf(campaigner);
        vm.prank(admin);
        escrow.closeCampaign(id);
        assertEq(usdc.balanceOf(campaigner) - before_, NET);
    }

    function test_poolShare_unevenWeights() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PoolShare, 0, false);
        vm.prank(campaigner);
        escrow.setWeights(id, _arr2(alice, bob), _u2(70, 30));
        vm.prank(admin);
        escrow.closeCampaign(id);
        assertEq(escrow.claimable(id, alice), (NET * 70) / 100);
        assertEq(escrow.claimable(id, bob), (NET * 30) / 100);
    }

    function test_poolShare_setWeightsChecks() public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PoolShare, 0, false);
        vm.prank(eve);
        vm.expectRevert(ClippoEscrow.NotApprover.selector);
        escrow.setWeights(id, _arr(alice), _u(1));
        vm.startPrank(campaigner);
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        escrow.setWeights(id, _arr(alice), _u(0)); // zero weight
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        escrow.setWeights(id, _arr2(alice, alice), _u2(1, 1)); // duplicate
        vm.stopPrank();

        uint256 hs = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, false);
        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.BadMode.selector);
        escrow.setWeights(hs, _arr(alice), _u(1));
    }

    // ------------------------------------------- retention window
    function test_retention_defaultIs7Days() public {
        ClippoEscrow fresh = new ClippoEscrow(address(usdc), treasury, owner);
        assertEq(fresh.retentionPeriod(), 7 days);
    }

    function test_retention_blocksClaimUntilMatured() public {
        vm.prank(owner);
        escrow.setRetentionPeriod(7 days);
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 10_000); // 50 USDC credited at t0
        assertEq(escrow.claimable(id, alice), 0);
        assertEq(escrow.pendingTotal(id, alice), 50e6);
        vm.prank(alice);
        vm.expectRevert(ClippoEscrow.NothingToClaim.selector);
        escrow.claim(id);

        vm.warp(block.timestamp + 7 days - 1);
        assertEq(escrow.claimable(id, alice), 0);
        vm.warp(block.timestamp + 1);
        assertEq(escrow.claimable(id, alice), 50e6);
        vm.prank(alice);
        escrow.claim(id);
        assertEq(escrow.claimed(id, alice), 50e6);
    }

    function test_retention_tranchesMatureIndependently() public {
        vm.prank(owner);
        escrow.setRetentionPeriod(7 days);
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 10_000); // 50 at t0
        vm.warp(block.timestamp + 3 days);
        _report(id, alice, 12_000); // +10 at t0+3d
        vm.warp(block.timestamp + 4 days); // t0+7d: first matured only
        assertEq(escrow.claimable(id, alice), 50e6);
        vm.prank(alice);
        escrow.claim(id);
        assertEq(escrow.claimable(id, alice), 0);
        assertEq(escrow.pendingTotal(id, alice), 10e6);
        vm.warp(block.timestamp + 3 days);
        assertEq(escrow.claimable(id, alice), 10e6);
        vm.prank(alice);
        escrow.claim(id);
        assertEq(escrow.claimed(id, alice), 60e6);
    }

    function test_retention_sameDayCreditsMergeAndDelay() public {
        vm.prank(owner);
        escrow.setRetentionPeriod(7 days);
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 1_000);
        _report(id, alice, 2_000);
        assertEq(escrow.tranches(id, alice).length, 1);
        assertEq(escrow.tranches(id, alice)[0].amount, 10e6);
    }

    function test_retention_stillClaimableAfterCloseOnceMatured() public {
        vm.prank(owner);
        escrow.setRetentionPeriod(7 days);
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, 10_000);
        vm.prank(admin);
        escrow.closeCampaign(id);
        assertEq(escrow.claimable(id, alice), 0);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        escrow.claim(id);
        assertEq(usdc.balanceOf(address(escrow)), escrow.treasuryAccrued());
    }

    function test_retention_configBounds() public {
        vm.prank(owner);
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        escrow.setRetentionPeriod(31 days);
        vm.prank(eve);
        vm.expectRevert();
        escrow.setRetentionPeriod(1 days);
    }

    function test_retention_doesNotApplyToHumanSplit() public {
        vm.prank(owner);
        escrow.setRetentionPeriod(7 days);
        uint256 id = _createApproved(ClippoEscrow.Mode.HumanSplit, 0, false);
        vm.prank(campaigner);
        escrow.approveSplit(id, _arr(alice), _u(100e6));
        assertEq(escrow.claimable(id, alice), 100e6);
    }

    // ------------------------------------------------ high value
    function test_highValue_defaultThreshold() public {
        ClippoEscrow fresh = new ClippoEscrow(address(usdc), treasury, owner);
        assertEq(fresh.highValueThreshold(), 1_000e6);
    }

    function test_highValue_flagAtThreshold() public {
        vm.prank(owner);
        escrow.setHighValueThreshold(1_000e6);
        // pool net must be strictly > 1000e6
        vm.startPrank(campaigner);
        uint256 lo = escrow.createCampaign(ClippoEscrow.Mode.PerView, 1e6, 1000e6, deadline, false, ""); // net 997.5
        uint256 hi = escrow.createCampaign(ClippoEscrow.Mode.PerView, 1e6, 1003e6, deadline, false, ""); // net 1000.49
        vm.stopPrank();
        assertFalse(escrow.getCampaign(lo).highValue);
        assertTrue(escrow.getCampaign(hi).highValue);
    }

    function test_highValue_approvalNeedsAttestation() public {
        vm.prank(owner);
        escrow.setHighValueThreshold(1_000e6);
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false); // POOL 10k => high value
        assertTrue(escrow.getCampaign(id).highValue);
        vm.prank(admin);
        vm.expectRevert(ClippoEscrow.AttestationRequired.selector);
        escrow.approveCampaign(id);
        vm.prank(admin);
        vm.expectRevert(ClippoEscrow.AttestationRequired.selector);
        escrow.approveCampaign(id, bytes32(0));

        bytes32 att = keccak256("world-id-proof-admin");
        vm.expectEmit(true, true, false, true);
        emit ClippoEscrow.HumanAttested(id, admin, att, 1);
        vm.prank(admin);
        escrow.approveCampaign(id, att);
        assertEq(escrow.approvalAttestation(id), att);
        assertEq(uint8(escrow.getCampaign(id).state), uint8(ClippoEscrow.State.Approved));
    }

    function test_highValue_lowValueDoesNotNeedAttestation() public {
        vm.prank(owner);
        escrow.setHighValueThreshold(type(uint256).max);
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        assertEq(escrow.approvalAttestation(id), bytes32(0));
    }

    function test_highValue_splitNeedsAttestationPerApprover() public {
        vm.prank(owner);
        escrow.setHighValueThreshold(1_000e6);
        uint256 id = _create(ClippoEscrow.Mode.HumanSplit, 0, true);
        vm.prank(admin);
        escrow.approveCampaign(id, keccak256("a"));

        vm.prank(campaigner);
        vm.expectRevert(ClippoEscrow.AttestationRequired.selector);
        escrow.approveSplit(id, _arr(alice), _u(100e6));

        bytes32 ac = keccak256("campaigner-proof");
        bytes32 aa = keccak256("admin-proof");
        vm.prank(campaigner);
        escrow.approveSplit(id, _arr(alice), _u(100e6), ac);
        assertEq(escrow.claimable(id, alice), 0);
        vm.prank(admin);
        escrow.approveSplit(id, _arr(alice), _u(100e6), aa);
        assertEq(escrow.claimable(id, alice), 100e6);
        assertEq(escrow.splitAttestation(id, campaigner), ac);
        assertEq(escrow.splitAttestation(id, admin), aa);
    }

    function test_highValue_thresholdOnlyOwner() public {
        vm.prank(eve);
        vm.expectRevert();
        escrow.setHighValueThreshold(1);
    }

    // --------------------------------- admin reject after funding
    function test_reject_highValueAfterFunding_fullRefundNoAttestationNeeded() public {
        vm.prank(owner);
        escrow.setHighValueThreshold(1_000e6);
        uint256 before_ = usdc.balanceOf(campaigner);
        uint256 id = _create(ClippoEscrow.Mode.PerView, 5e6, false);
        assertTrue(escrow.getCampaign(id).highValue);
        vm.expectEmit(true, true, false, true);
        emit ClippoEscrow.CampaignRejected(id, admin, POOL);
        vm.prank(admin);
        escrow.rejectCampaign(id);
        assertEq(usdc.balanceOf(campaigner), before_); // full refund incl. fee
        assertEq(escrow.treasuryAccrued(), 0);
    }

    // ------------------------------------------------ invariants
    function testFuzz_perView_neverExceedsPool(uint128 v1, uint128 v2, uint64 rate) public {
        rate = uint64(bound(rate, 1, 10_000e6));
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, rate, false);
        _report(id, alice, v1);
        _report(id, bob, v2);
        ClippoEscrow.Campaign memory c = escrow.getCampaign(id);
        assertLe(c.allocated, c.pool);
        assertEq(c.allocated, escrow.claimable(id, alice) + escrow.claimable(id, bob));
    }

    function testFuzz_claimConservesFunds(uint32 views) public {
        uint256 id = _createApproved(ClippoEscrow.Mode.PerView, 5e6, false);
        _report(id, alice, views);
        uint256 total = usdc.balanceOf(address(escrow));
        if (escrow.claimable(id, alice) == 0) return;
        vm.prank(alice);
        uint256 net = escrow.claim(id);
        assertEq(usdc.balanceOf(address(escrow)) + net, total);
    }

    function test_constructor_rejectsNon6DecimalToken() public {
        Fake18 bad = new Fake18();
        vm.expectRevert(ClippoEscrow.BadParams.selector);
        new ClippoEscrow(address(bad), treasury, owner);
    }
}

/// @dev Interface id helper matching IReceiver.onReport(bytes,bytes) (+ ERC165 is excluded by XOR semantics).
interface IReceiverId {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @dev Stands in for the 18-decimal native-USDC representation that must never be used as the escrow token.
contract Fake18 {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}
