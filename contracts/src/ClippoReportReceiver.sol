// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IClippoEscrow {
    function reportViews(uint256 campaignId, address creator, uint256 cumulativeViews) external;
}

/// @title ClippoReportReceiver
/// @notice Reporting adapter. Chainlink CRE delivers signed reports through the KeystoneForwarder, which calls
///         onReport(metadata, report). The report is abi.encode((uint256 campaignId, address creator, uint256 cumulativeViews)[]).
///         Each item is forwarded to ClippoEscrow.reportViews; a failing item is skipped and logged so one bad
///         row cannot block the batch.
/// @dev Authentication follows Chainlink's ReceiverTemplate pattern (docs.chain.link/cre, "Building Consumer Contracts"):
///      1. msg.sender must be the configured forwarder (the forwarder verifies the DON signatures);
///      2. the forwarder accepts a report from ANY workflow of ANY user, so the workflow identity in `metadata` is
///         also checked: workflow owner (mandatory) plus optional workflow id and workflow name (bytes10).
///      metadata layout (production KeystoneForwarder passes 64 bytes): [0:32) workflowId bytes32,
///      [32:42) workflowName bytes10, [42:62) workflowOwner address, [62:64) reportId bytes2.
///      FAIL CLOSED: if expectedWorkflowOwner is unset, onReport reverts. The only bypass is the explicit
///      `workflowCheckSkipped` flag, which exists solely because the CRE simulation MockKeystoneForwarder does not
///      supply workflow metadata. NEVER enable it on a production deployment.
contract ClippoReportReceiver is IReceiver, Ownable {
    struct ViewReport {
        uint256 campaignId;
        address creator;
        uint256 cumulativeViews;
    }

    uint256 internal constant MIN_METADATA_LENGTH = 62;

    IClippoEscrow public immutable escrow;
    address public forwarder;
    /// @notice Required workflow owner (the CRE account address that owns the workflow). address(0) = unconfigured (fail closed).
    address public expectedWorkflowOwner;
    /// @notice Optional workflow id (bytes32(0) = not checked).
    bytes32 public expectedWorkflowId;
    /// @notice Optional workflow name as bytes10 (bytes10(0) = not checked). Checked together with the owner.
    bytes10 public expectedWorkflowName;
    /// @notice TEST/SIMULATION ONLY. When true the metadata checks are skipped (the sender check still applies).
    bool public workflowCheckSkipped;

    event ForwarderSet(address indexed forwarder);
    event ExpectedWorkflowOwnerSet(address indexed previousOwner, address indexed newOwner);
    event ExpectedWorkflowIdSet(bytes32 indexed previousId, bytes32 indexed newId);
    event ExpectedWorkflowNameSet(bytes10 indexed previousName, bytes10 indexed newName);
    event WorkflowCheckSkippedSet(bool skipped);
    event ReportProcessed(uint256 items, uint256 failed);
    event ItemFailed(uint256 indexed campaignId, address indexed creator, bytes reason);

    error NotForwarder();
    error WorkflowOwnerNotConfigured();
    error BadMetadata();
    error InvalidWorkflowOwner(address received, address expected);
    error InvalidWorkflowId(bytes32 received, bytes32 expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);

    /// @param expectedWorkflowOwner_ allowed workflow owner. If address(0) every report reverts until the owner sets it
    ///        (unless insecureSkipWorkflowCheck_ is true).
    /// @param insecureSkipWorkflowCheck_ TEST/SIMULATION ONLY (mock forwarders pass no metadata). Must be false in production.
    constructor(
        address escrow_,
        address forwarder_,
        address owner_,
        address expectedWorkflowOwner_,
        bool insecureSkipWorkflowCheck_
    ) Ownable(owner_) {
        escrow = IClippoEscrow(escrow_);
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
        if (expectedWorkflowOwner_ != address(0)) {
            expectedWorkflowOwner = expectedWorkflowOwner_;
            emit ExpectedWorkflowOwnerSet(address(0), expectedWorkflowOwner_);
        }
        if (insecureSkipWorkflowCheck_) {
            workflowCheckSkipped = true;
            emit WorkflowCheckSkippedSet(true);
        }
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @notice address(0) un-configures the owner, which makes onReport fail closed again.
    function setExpectedWorkflowOwner(address owner_) external onlyOwner {
        emit ExpectedWorkflowOwnerSet(expectedWorkflowOwner, owner_);
        expectedWorkflowOwner = owner_;
    }

    /// @notice bytes32(0) disables the optional id check.
    function setExpectedWorkflowId(bytes32 id_) external onlyOwner {
        emit ExpectedWorkflowIdSet(expectedWorkflowId, id_);
        expectedWorkflowId = id_;
    }

    /// @notice bytes10(0) disables the optional name check. Value is the raw bytes10 from report metadata:
    ///         hex-encode the first 10 hex chars of sha256(workflowName) (see contracts/README.md).
    function setExpectedWorkflowName(bytes10 name_) external onlyOwner {
        emit ExpectedWorkflowNameSet(expectedWorkflowName, name_);
        expectedWorkflowName = name_;
    }

    /// @notice TEST/SIMULATION ONLY: skip metadata validation (mock forwarders pass none). Keep false in production.
    function setWorkflowCheckSkipped(bool skipped) external onlyOwner {
        workflowCheckSkipped = skipped;
        emit WorkflowCheckSkippedSet(skipped);
    }

    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder();
        if (!workflowCheckSkipped) _checkWorkflow(metadata);
        ViewReport[] memory items = abi.decode(report, (ViewReport[]));
        uint256 failed;
        for (uint256 i; i < items.length; ++i) {
            try escrow.reportViews(items[i].campaignId, items[i].creator, items[i].cumulativeViews) {}
            catch (bytes memory reason) {
                ++failed;
                emit ItemFailed(items[i].campaignId, items[i].creator, reason);
            }
        }
        emit ReportProcessed(items.length, failed);
    }

    function _checkWorkflow(bytes calldata metadata) internal view {
        address expectedOwner = expectedWorkflowOwner;
        if (expectedOwner == address(0)) revert WorkflowOwnerNotConfigured();
        if (metadata.length < MIN_METADATA_LENGTH) revert BadMetadata();
        bytes32 workflowId = bytes32(metadata[0:32]);
        bytes10 workflowName = bytes10(metadata[32:42]);
        address workflowOwner = address(bytes20(metadata[42:62]));

        if (workflowOwner != expectedOwner) revert InvalidWorkflowOwner(workflowOwner, expectedOwner);
        bytes32 expectedId = expectedWorkflowId;
        if (expectedId != bytes32(0) && workflowId != expectedId) revert InvalidWorkflowId(workflowId, expectedId);
        bytes10 expectedName = expectedWorkflowName;
        if (expectedName != bytes10(0) && workflowName != expectedName) {
            revert InvalidWorkflowName(workflowName, expectedName);
        }
    }

    function supportsInterface(bytes4 id) external pure override returns (bool) {
        return id == type(IReceiver).interfaceId || id == type(IERC165).interfaceId;
    }
}
