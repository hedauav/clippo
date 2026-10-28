// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ClippoCreatorProfile
/// @notice OPTIONAL MODULE, off by default (see LEGAL_REVIEW.md). Non-transferable (soulbound-style) on-chain
///         profile and track record for a creator who opts in. It is NOT a token: there is no ERC-20/721
///         interface, no transfer, no approval, no balance, no price and no secondary market. A record is bound
///         to one wallet (it can only be revoked/deleted). Only an authorized updater writes stats.
contract ClippoCreatorProfile is Ownable {
    struct Profile {
        bool exists;
        uint8 tier; // 0 none, 1 Verified, 2 Rising, 3 Partner, 4 Top
        uint32 approvedClips;
        uint32 rejectedClips;
        uint64 totalViews;
        uint64 totalEarnedUsdc; // 6 decimals
        uint64 createdAt;
        uint64 updatedAt;
        string metadataURI;
    }

    uint8 public constant MAX_TIER = 4;

    mapping(address => Profile) private _profiles;
    mapping(address => bool) public updaters;
    uint256 public profileCount;

    event UpdaterSet(address indexed who, bool allowed);
    event ProfileCreated(address indexed creator);
    event ProfileUpdated(
        address indexed creator,
        uint8 tier,
        uint32 approvedClips,
        uint32 rejectedClips,
        uint64 totalViews,
        uint64 totalEarnedUsdc,
        string metadataURI
    );
    event ProfileRevoked(address indexed creator, address indexed by);

    error NotUpdater();
    error NoProfile();
    error AlreadyOptedIn();
    error BadTier();
    error NonTransferable();

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyUpdater() {
        if (!updaters[msg.sender]) revert NotUpdater();
        _;
    }

    function setUpdater(address who, bool allowed) external onlyOwner {
        updaters[who] = allowed;
        emit UpdaterSet(who, allowed);
    }

    /// @notice Creator opts in to having an on-chain profile.
    function optIn() external {
        Profile storage p = _profiles[msg.sender];
        if (p.exists) revert AlreadyOptedIn();
        p.exists = true;
        p.createdAt = uint64(block.timestamp);
        p.updatedAt = uint64(block.timestamp);
        ++profileCount;
        emit ProfileCreated(msg.sender);
    }

    /// @notice Creator opts out; deletes their record.
    function optOut() external {
        _revoke(msg.sender, msg.sender);
    }

    /// @notice Owner may revoke a record (e.g. fraud).
    function revoke(address creator) external onlyOwner {
        _revoke(creator, msg.sender);
    }

    function _revoke(address creator, address by) internal {
        if (!_profiles[creator].exists) revert NoProfile();
        delete _profiles[creator];
        --profileCount;
        emit ProfileRevoked(creator, by);
    }

    /// @notice Authorized updater overwrites the track record of an opted-in creator.
    function updateProfile(
        address creator,
        uint8 tier,
        uint32 approvedClips,
        uint32 rejectedClips,
        uint64 totalViews,
        uint64 totalEarnedUsdc,
        string calldata metadataURI
    ) external onlyUpdater {
        Profile storage p = _profiles[creator];
        if (!p.exists) revert NoProfile();
        if (tier > MAX_TIER) revert BadTier();
        p.tier = tier;
        p.approvedClips = approvedClips;
        p.rejectedClips = rejectedClips;
        p.totalViews = totalViews;
        p.totalEarnedUsdc = totalEarnedUsdc;
        p.metadataURI = metadataURI;
        p.updatedAt = uint64(block.timestamp);
        emit ProfileUpdated(creator, tier, approvedClips, rejectedClips, totalViews, totalEarnedUsdc, metadataURI);
    }

    function getProfile(address creator) external view returns (Profile memory) {
        return _profiles[creator];
    }

    function hasProfile(address creator) external view returns (bool) {
        return _profiles[creator].exists;
    }

    function tierOf(address creator) external view returns (uint8) {
        return _profiles[creator].tier;
    }

    /// @dev Explicitly not transferable: gives integrators a clear revert instead of a silent no-op.
    function transfer(address, address) external pure {
        revert NonTransferable();
    }
}
