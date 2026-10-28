// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClippoReferral} from "../src/ClippoReferral.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract ClippoReferralTest is Test {
    ClippoReferral r;
    MockUSDC usdc;
    address owner = makeAddr("owner");
    address rec = makeAddr("recorder");
    address guardian = makeAddr("guardian");
    address ref1 = makeAddr("ref1");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address funder = makeAddr("funder");

    function setUp() public {
        usdc = new MockUSDC();
        r = new ClippoReferral(address(usdc), owner, 500, 100e6, 1 days); // 5%, cap 100, 1d cooldown
        vm.startPrank(owner);
        r.setRecorder(rec, true);
        r.setGuardian(guardian, true);
        vm.stopPrank();
        usdc.mint(funder, 1_000e6);
        vm.startPrank(funder);
        usdc.approve(address(r), type(uint256).max);
        r.fund(500e6);
        vm.stopPrank();
        vm.startPrank(rec);
        r.setUniqueHuman(bob, true);
        r.setUniqueHuman(carol, true);
        vm.stopPrank();
    }

    function test_attributeCreditClaim() public {
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        uint256 c = r.recordActivity(bob, 1_000e6);
        vm.stopPrank();
        assertEq(c, 50e6);
        assertEq(r.claimable(ref1), 50e6);
        vm.prank(ref1);
        r.claim();
        assertEq(usdc.balanceOf(ref1), 50e6);
        assertEq(r.totalOwed(), 0);
    }

    function test_onlyRecorder() public {
        vm.expectRevert(ClippoReferral.NotRecorder.selector);
        r.registerReferral(ref1, bob, 1);
    }

    function test_noSelfReferral() public {
        vm.prank(rec);
        vm.expectRevert(ClippoReferral.SelfReferral.selector);
        r.registerReferral(bob, bob, 1);
    }

    function test_refereeMustBeHuman() public {
        address bot = makeAddr("bot");
        vm.prank(rec);
        vm.expectRevert(ClippoReferral.NotHuman.selector);
        r.registerReferral(ref1, bot, 1);
    }

    function test_firstAttributionWins() public {
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        vm.expectRevert(ClippoReferral.AlreadyReferred.selector);
        r.registerReferral(carol, bob, 2);
        vm.stopPrank();
    }

    function test_noTwoCycle() public {
        vm.startPrank(rec);
        r.setUniqueHuman(ref1, true);
        r.registerReferral(ref1, bob, 1);
        vm.expectRevert(ClippoReferral.SelfReferral.selector);
        r.registerReferral(bob, ref1, 1);
        vm.stopPrank();
    }

    function test_cooldown() public {
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        r.recordActivity(bob, 100e6);
        vm.expectRevert(ClippoReferral.CooldownActive.selector);
        r.recordActivity(bob, 100e6);
        vm.warp(block.timestamp + 1 days);
        r.recordActivity(bob, 100e6);
        vm.stopPrank();
        assertEq(r.credited(ref1), 10e6);
    }

    function test_perReferrerCapClamps() public {
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        uint256 c = r.recordActivity(bob, 10_000e6); // 500 cut -> clamped to 100
        assertEq(c, 100e6);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(ClippoReferral.CapReached.selector);
        r.recordActivity(bob, 1_000e6);
        vm.stopPrank();
    }

    function test_freezeBlocksEarnAndClaim() public {
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        r.recordActivity(bob, 1_000e6);
        vm.stopPrank();
        vm.prank(guardian);
        r.setFrozen(ref1, true);
        assertEq(r.claimable(ref1), 0);
        vm.prank(ref1);
        vm.expectRevert(ClippoReferral.ReferrerFrozen.selector);
        r.claim();
        vm.warp(block.timestamp + 2 days);
        vm.prank(rec);
        vm.expectRevert(ClippoReferral.ReferrerFrozen.selector);
        r.recordActivity(bob, 1e6);
        vm.prank(guardian);
        r.setFrozen(ref1, false);
        vm.prank(ref1);
        r.claim();
        assertEq(usdc.balanceOf(ref1), 50e6);
    }

    function test_onlyGuardianFreezes() public {
        vm.expectRevert(ClippoReferral.NotGuardian.selector);
        r.setFrozen(ref1, true);
    }

    function test_underfundedReverts() public {
        vm.prank(owner);
        r.setParams(1000, 10_000e6, 0);
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        vm.expectRevert(ClippoReferral.Underfunded.selector);
        r.recordActivity(bob, 10_000e6); // 1000 > 500 funded
        vm.stopPrank();
    }

    function test_pause() public {
        vm.prank(owner);
        r.setPaused(true);
        vm.prank(rec);
        vm.expectRevert(ClippoReferral.IsPaused.selector);
        r.registerReferral(ref1, bob, 1);
    }

    function test_paramsBounds() public {
        vm.prank(owner);
        vm.expectRevert(ClippoReferral.BadParams.selector);
        r.setParams(1001, 1, 0);
    }

    function test_recoverUnowedKeepsOwed() public {
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        r.recordActivity(bob, 1_000e6);
        vm.stopPrank();
        vm.startPrank(owner);
        vm.expectRevert(ClippoReferral.Underfunded.selector);
        r.recoverUnowed(owner, 451e6);
        r.recoverUnowed(owner, 450e6);
        vm.stopPrank();
    }

    function testFuzz_neverExceedsCap(uint96 act) public {
        vm.startPrank(rec);
        r.registerReferral(ref1, bob, 1);
        try r.recordActivity(bob, act) {} catch {}
        vm.stopPrank();
        assertLe(r.credited(ref1), 100e6);
    }
}
