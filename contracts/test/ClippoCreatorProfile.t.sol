// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClippoCreatorProfile} from "../src/ClippoCreatorProfile.sol";

contract ClippoCreatorProfileTest is Test {
    ClippoCreatorProfile p;
    address owner = makeAddr("owner");
    address upd = makeAddr("updater");
    address alice = makeAddr("alice");

    function setUp() public {
        p = new ClippoCreatorProfile(owner);
        vm.prank(owner);
        p.setUpdater(upd, true);
    }

    function test_optInUpdateRead() public {
        vm.prank(alice);
        p.optIn();
        vm.prank(upd);
        p.updateProfile(alice, 2, 10, 1, 5000, 42e6, "ipfs://x");
        ClippoCreatorProfile.Profile memory pr = p.getProfile(alice);
        assertEq(pr.tier, 2);
        assertEq(pr.approvedClips, 10);
        assertEq(pr.totalEarnedUsdc, 42e6);
        assertEq(p.tierOf(alice), 2);
        assertEq(p.profileCount(), 1);
    }

    function test_cannotUpdateWithoutOptIn() public {
        vm.prank(upd);
        vm.expectRevert(ClippoCreatorProfile.NoProfile.selector);
        p.updateProfile(alice, 1, 0, 0, 0, 0, "");
    }

    function test_onlyUpdater() public {
        vm.prank(alice);
        p.optIn();
        vm.prank(alice);
        vm.expectRevert(ClippoCreatorProfile.NotUpdater.selector);
        p.updateProfile(alice, 4, 999, 0, 0, 0, "");
    }

    function test_badTier() public {
        vm.prank(alice);
        p.optIn();
        vm.prank(upd);
        vm.expectRevert(ClippoCreatorProfile.BadTier.selector);
        p.updateProfile(alice, 5, 0, 0, 0, 0, "");
    }

    function test_doubleOptIn() public {
        vm.startPrank(alice);
        p.optIn();
        vm.expectRevert(ClippoCreatorProfile.AlreadyOptedIn.selector);
        p.optIn();
        vm.stopPrank();
    }

    function test_optOutAndRevoke() public {
        vm.prank(alice);
        p.optIn();
        vm.prank(alice);
        p.optOut();
        assertFalse(p.hasProfile(alice));
        vm.prank(alice);
        p.optIn();
        vm.prank(owner);
        p.revoke(alice);
        assertEq(p.profileCount(), 0);
    }

    function test_nonTransferable() public {
        address bob = makeAddr("bob");
        vm.expectRevert(ClippoCreatorProfile.NonTransferable.selector);
        p.transfer(alice, bob);
    }

    function test_onlyOwnerSetsUpdater() public {
        vm.prank(alice);
        vm.expectRevert();
        p.setUpdater(alice, true);
    }
}
