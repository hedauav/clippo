// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClippoEscrow} from "../src/ClippoEscrow.sol";
import {ClippoReportReceiver} from "../src/ClippoReportReceiver.sol";
import {ClippoReferral} from "../src/ClippoReferral.sol";
import {ClippoCreatorProfile} from "../src/ClippoCreatorProfile.sol";

/// @notice One-shot production deploy (Arc testnet). Does NOT deploy MockUSDC (see DeployMock.s.sol).
/// REQUIRED env: ADMIN_ADDRESS, FORWARDER_ADDRESS (Chainlink CRE KeystoneForwarder), UPDATER_ADDRESS,
///   EXPECTED_WORKFLOW_OWNER (CRE workflow owner address; the receiver rejects reports from any other workflow owner)
///   unless INSECURE_SKIP_WORKFLOW_CHECK is true (see below).
/// OPTIONAL env (default):
///   EXPECTED_WORKFLOW_ID (unset; bytes32 hex), EXPECTED_WORKFLOW_NAME (unset; bytes10 hex, e.g. 0x62373666336165316465),
///   INSECURE_SKIP_WORKFLOW_CHECK (false; true when ALLOW_ANY_CHAIN=true so local anvil/mock runs keep working).
///     TEST/SIMULATION ONLY: the CRE simulation MockKeystoneForwarder passes no workflow metadata, so the metadata check
///     must be skipped for `cre workflow simulate --broadcast`. NEVER set true for a production deployment.
///   USDC_ADDRESS (0x3600...0000 Arc testnet USDC), TREASURY_ADDRESS (ADMIN_ADDRESS),
///   RECORDER_ADDRESS (UPDATER_ADDRESS; referral recorder), GUARDIAN_ADDRESS (ADMIN_ADDRESS; referral guardian),
///   CAMPAIGNER_FEE_BPS (25), CREATOR_FEE_BPS (25) [max 50 each], RETENTION_SECONDS (604800), HIGH_VALUE_THRESHOLD (1000000000),
///   REFERRAL_CUT_BPS (500, max 1000), REFERRAL_CAP (100000000), REFERRAL_COOLDOWN (86400).
/// The broadcaster (deployer) owns everything during setup, then ownership of all contracts moves to ADMIN_ADDRESS
/// and the deployer's escrow admin right is revoked (unless deployer == ADMIN_ADDRESS).
contract Deploy is Script {
    address public constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    ClippoEscrow public escrow;
    ClippoReportReceiver public receiver;
    ClippoReferral public referral;
    ClippoCreatorProfile public profile;
    address public usdc;
    uint256 public deployBlock;

    function _required(string memory name) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        require(a != address(0), string.concat("Deploy: missing required env ", name));
    }

    function _workflowName(string memory hexName) internal pure returns (bytes10) {
        if (bytes(hexName).length == 0) return bytes10(0);
        bytes memory b = vm.parseBytes(hexName);
        require(b.length == 10, "Deploy: EXPECTED_WORKFLOW_NAME must be 10 bytes hex");
        return bytes10(b);
    }

    function run() external {
        // Arc testnet = 5042002. Refuse other chains unless ALLOW_ANY_CHAIN=true (e.g. local anvil dry runs).
        require(block.chainid == 5042002 || vm.envOr("ALLOW_ANY_CHAIN", false), "Deploy: not Arc testnet (5042002)");
        address admin = _required("ADMIN_ADDRESS");
        address forwarder = _required("FORWARDER_ADDRESS");
        address updater = _required("UPDATER_ADDRESS");
        // Local anvil/mock runs (ALLOW_ANY_CHAIN=true) default to skipping the workflow-metadata check; everything else
        // must name the expected workflow owner (fail closed).
        bool skipCheck = vm.envOr("INSECURE_SKIP_WORKFLOW_CHECK", vm.envOr("ALLOW_ANY_CHAIN", false));
        address wfOwner = vm.envOr("EXPECTED_WORKFLOW_OWNER", address(0));
        require(
            wfOwner != address(0) || skipCheck,
            "Deploy: missing required env EXPECTED_WORKFLOW_OWNER (or INSECURE_SKIP_WORKFLOW_CHECK=true for simulation)"
        );
        bytes32 wfId = vm.envOr("EXPECTED_WORKFLOW_ID", bytes32(0));
        bytes10 wfName = _workflowName(vm.envOr("EXPECTED_WORKFLOW_NAME", string("")));
        if (skipCheck) console.log("WARNING: workflow metadata check SKIPPED (test/simulation only)");
        usdc = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);
        address treasury = vm.envOr("TREASURY_ADDRESS", admin);
        address recorder = vm.envOr("RECORDER_ADDRESS", updater);
        address guardian = vm.envOr("GUARDIAN_ADDRESS", admin);
        uint256 cb = vm.envOr("CAMPAIGNER_FEE_BPS", uint256(25));
        uint256 rb = vm.envOr("CREATOR_FEE_BPS", uint256(25));
        require(cb <= 50 && rb <= 50, "Deploy: fee bps max 50");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        escrow = new ClippoEscrow(usdc, treasury, deployer);
        receiver = new ClippoReportReceiver(address(escrow), forwarder, deployer, wfOwner, skipCheck);
        if (wfId != bytes32(0)) receiver.setExpectedWorkflowId(wfId);
        if (wfName != bytes10(0)) receiver.setExpectedWorkflowName(wfName);
        escrow.setReportAdapter(address(receiver));
        escrow.setFees(uint16(cb), uint16(rb));
        escrow.setRetentionPeriod(uint64(vm.envOr("RETENTION_SECONDS", uint256(7 days))));
        escrow.setHighValueThreshold(vm.envOr("HIGH_VALUE_THRESHOLD", uint256(1_000e6)));

        referral = new ClippoReferral(
            usdc,
            deployer,
            vm.envOr("REFERRAL_CUT_BPS", uint256(500)),
            vm.envOr("REFERRAL_CAP", uint256(100e6)),
            uint64(vm.envOr("REFERRAL_COOLDOWN", uint256(1 days)))
        );
        referral.setRecorder(recorder, true);
        referral.setGuardian(guardian, true);

        profile = new ClippoCreatorProfile(deployer);
        profile.setUpdater(updater, true);

        if (admin != deployer) {
            escrow.setAdmin(admin, true);
            escrow.setAdmin(deployer, false);
            escrow.transferOwnership(admin);
            receiver.transferOwnership(admin);
            referral.transferOwnership(admin);
            profile.transferOwnership(admin);
        }
        deployBlock = block.number;
        vm.stopBroadcast();

        console.log("USDC", usdc);
        console.log("ExpectedWorkflowOwner", wfOwner);
        console.log("WorkflowCheckSkipped", skipCheck);
        console.log("ClippoEscrow", address(escrow));
        console.log("ClippoReportReceiver", address(receiver));
        console.log("ClippoReferral", address(referral));
        console.log("ClippoCreatorProfile", address(profile));
        console.log("");
        console.log("# ---- paste into web/.env.local ----");
        console.log("ESCROW_ADDRESS=%s", address(escrow));
        console.log("ESCROW_DEPLOY_BLOCK=%s", deployBlock);
        console.log("REFERRAL_ADDRESS=%s", address(referral));
        console.log("PROFILE_ADDRESS=%s", address(profile));
        console.log("REPORT_RECEIVER_ADDRESS=%s", address(receiver));
        console.log("EXPECTED_WORKFLOW_OWNER=%s", wfOwner);
        console.log("USDC_ADDRESS=%s", usdc);
    }
}
