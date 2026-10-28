// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ClippoEscrow
/// @notice Holds many independent USDC campaigns. Lifecycle: Funded -> Approved (admin) -> Closed,
///         or Funded -> Rejected (full refund incl. fee). Three settlement modes: PerView, HumanSplit, PoolShare.
///         Creators pull their payouts; fees accrue to the treasury.
contract ClippoEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types
    enum Mode {
        PerView,
        HumanSplit,
        PoolShare
    }

    enum State {
        None,
        Funded,
        Approved,
        Rejected,
        Closed
    }

    struct Campaign {
        address campaigner;
        Mode mode;
        State state;
        bool requireAdminApproval; // HumanSplit: both campaigner and an admin must approve a split
        uint16 campaignerFeeBps; // snapshot at creation
        uint16 creatorFeeBps; // snapshot at creation
        uint64 deadline;
        uint256 ratePer1kViews; // USDC base units per 1000 views (PerView)
        uint256 grossFunded; // total pulled from campaigner
        uint256 campaignerFee; // fee withheld from grossFunded
        uint256 pool; // grossFunded - campaignerFee
        uint256 allocated; // credited to creators so far (<= pool)
        string metadataURI;
        bool highValue; // pool > highValueThreshold at creation: approvals need a human attestation hash
    }

    /// @dev PerView credit tranche; matures `retentionPeriod` after `at`.
    struct Tranche {
        uint64 at;
        uint192 amount;
    }

    struct PendingSplit {
        bytes32 hash;
        bool byCampaigner;
        bool byAdmin;
    }

    // -------------------------------------------------------------- storage
    uint16 public constant MAX_FEE_BPS = 50;
    uint256 public constant MAX_BATCH = 200;

    IERC20 public immutable usdc;
    address public treasury;
    uint16 public campaignerFeeBps = 25;
    uint16 public creatorFeeBps = 25;
    address public reportAdapter; // only address allowed to call reportViews
    uint256 public treasuryAccrued;
    uint256 public campaignCount;
    uint64 public constant MAX_RETENTION = 30 days;
    /// @notice PerView credits become claimable only this long after they are credited (clawback/anti-fraud window).
    uint64 public retentionPeriod = 7 days;
    /// @notice Pools strictly above this (USDC base units, default $1,000) are "high value".
    uint256 public highValueThreshold = 1_000e6;

    mapping(address => bool) public isAdmin;
    mapping(uint256 => Campaign) private _campaigns;
    mapping(uint256 => mapping(address => uint256)) public credited; // total credited to creator
    mapping(uint256 => mapping(address => uint256)) public claimed; // total gross claimed by creator
    mapping(uint256 => mapping(address => uint256)) public reportedViews; // PerView cumulative views
    mapping(uint256 => mapping(address => uint256)) public weights; // PoolShare weights
    mapping(uint256 => address[]) private _weightCreators;
    mapping(uint256 => uint256) public totalWeight;
    mapping(uint256 => PendingSplit) public pendingSplit;
    mapping(uint256 => bytes32) public approvalAttestation; // high-value campaign approval attestation
    mapping(uint256 => mapping(address => bytes32)) public splitAttestation; // id => approver => latest attestation
    mapping(uint256 => mapping(address => Tranche[])) private _tranches;
    mapping(uint256 => mapping(address => uint256)) private _nextTranche; // first tranche not yet released
    mapping(uint256 => mapping(address => uint256)) private _released; // gross amount of released (matured) tranches

    // --------------------------------------------------------------- events
    event AdminSet(address indexed admin, bool allowed);
    event FeesSet(uint16 campaignerFeeBps, uint16 creatorFeeBps);
    event TreasurySet(address indexed treasury);
    event ReportAdapterSet(address indexed adapter);
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed campaigner,
        Mode mode,
        uint256 ratePer1kViews,
        uint256 grossFunded,
        uint256 campaignerFee,
        uint256 pool,
        uint64 deadline,
        bool requireAdminApproval,
        string metadataURI
    );
    event CampaignApproved(uint256 indexed campaignId, address indexed admin, uint256 feeToTreasury);
    event CampaignRejected(uint256 indexed campaignId, address indexed admin, uint256 refunded);
    event ViewsReported(
        uint256 indexed campaignId,
        address indexed creator,
        uint256 cumulativeViews,
        uint256 deltaViews,
        uint256 credited
    );
    event SplitProposed(uint256 indexed campaignId, address indexed approver, bytes32 splitHash);
    event SplitApproved(uint256 indexed campaignId, address indexed approver, bytes32 splitHash);
    event SplitFinalized(uint256 indexed campaignId, bytes32 splitHash, uint256 total);
    event WeightsSet(uint256 indexed campaignId, address indexed approver, uint256 creatorCount, uint256 totalWeight);
    event CreatorCredited(uint256 indexed campaignId, address indexed creator, uint256 amount);
    event CampaignClosed(uint256 indexed campaignId, address indexed by, uint256 refundedToCampaigner);
    event Claimed(uint256 indexed campaignId, address indexed creator, uint256 gross, uint256 fee, uint256 net);
    event FeesWithdrawn(address indexed treasury, uint256 amount);
    event RetentionSet(uint64 retentionPeriod);
    event HighValueThresholdSet(uint256 threshold);
    /// @dev kind: 1 = campaign approval, 2 = split approval
    event HumanAttested(uint256 indexed campaignId, address indexed approver, bytes32 attestation, uint8 kind);

    // --------------------------------------------------------------- errors
    error NotAdmin();
    error NotAdapter();
    error NotApprover();
    error BadState(State current);
    error BadMode();
    error BadParams();
    error FeeTooHigh();
    error DeadlinePassed();
    error DeadlineNotReached();
    error NothingToClaim();
    error PoolExceeded();
    error NotCampaigner();
    error AttestationRequired();

    constructor(address usdc_, address treasury_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || treasury_ == address(0)) revert BadParams();
        // Arc: the ERC-20 interface of USDC has 6 decimals (the native gas balance has 18). All amounts here are ERC-20 units.
        if (IERC20Metadata(usdc_).decimals() != 6) revert BadParams();
        usdc = IERC20(usdc_);
        treasury = treasury_;
        isAdmin[owner_] = true;
        emit AdminSet(owner_, true);
    }

    modifier onlyAdmin() {
        if (!isAdmin[msg.sender]) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------------- admin
    function setAdmin(address admin, bool allowed) external onlyOwner {
        isAdmin[admin] = allowed;
        emit AdminSet(admin, allowed);
    }

    /// @notice Set per-side fees in bps (max 50 = 0.5%). Applies to campaigns created afterwards.
    function setFees(uint16 campaignerBps, uint16 creatorBps) external onlyOwner {
        if (campaignerBps > MAX_FEE_BPS || creatorBps > MAX_FEE_BPS) revert FeeTooHigh();
        campaignerFeeBps = campaignerBps;
        creatorFeeBps = creatorBps;
        emit FeesSet(campaignerBps, creatorBps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert BadParams();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Set the reporting adapter (the only caller of reportViews).
    function setReportAdapter(address adapter) external onlyOwner {
        reportAdapter = adapter;
        emit ReportAdapterSet(adapter);
    }

    /// @notice Set the PerView retention window (0..30 days). Applies to all unreleased credits.
    function setRetentionPeriod(uint64 period) external onlyOwner {
        if (period > MAX_RETENTION) revert BadParams();
        retentionPeriod = period;
        emit RetentionSet(period);
    }

    /// @notice Set the high-value pool threshold (USDC base units). Applies to campaigns created afterwards.
    function setHighValueThreshold(uint256 threshold) external onlyOwner {
        highValueThreshold = threshold;
        emit HighValueThresholdSet(threshold);
    }

    function withdrawFees() external nonReentrant {
        uint256 amount = treasuryAccrued;
        if (amount == 0) revert NothingToClaim();
        treasuryAccrued = 0;
        usdc.safeTransfer(treasury, amount);
        emit FeesWithdrawn(treasury, amount);
    }

    // ------------------------------------------------------------- campaign
    /// @notice Fund a new campaign. Pulls `poolAmount` USDC from the caller; the campaigner fee is deducted
    ///         from it, so the usable pool is poolAmount - fee. Caller must have approved this contract.
    function createCampaign(
        Mode mode,
        uint256 ratePer1kViews,
        uint256 poolAmount,
        uint64 deadline,
        bool requireAdminApproval,
        string calldata metadataURI
    ) external nonReentrant returns (uint256 id) {
        if (poolAmount == 0 || deadline <= block.timestamp) revert BadParams();
        if (mode == Mode.PerView && ratePer1kViews == 0) revert BadParams();

        uint256 fee = (poolAmount * campaignerFeeBps) / 10_000;
        id = ++campaignCount;
        Campaign storage c = _campaigns[id];
        c.campaigner = msg.sender;
        c.mode = mode;
        c.state = State.Funded;
        c.requireAdminApproval = requireAdminApproval;
        c.campaignerFeeBps = campaignerFeeBps;
        c.creatorFeeBps = creatorFeeBps;
        c.deadline = deadline;
        c.ratePer1kViews = ratePer1kViews;
        c.grossFunded = poolAmount;
        c.campaignerFee = fee;
        c.pool = poolAmount - fee;
        c.metadataURI = metadataURI;
        c.highValue = c.pool > highValueThreshold;

        usdc.safeTransferFrom(msg.sender, address(this), poolAmount);
        emit CampaignCreated(
            id, msg.sender, mode, ratePer1kViews, poolAmount, fee, c.pool, deadline, requireAdminApproval, metadataURI
        );
    }

    /// @notice Admin approves a funded campaign; the withheld campaigner fee accrues to the treasury.
    ///         High-value campaigns must use the attestation overload.
    function approveCampaign(uint256 id) external onlyAdmin {
        _approveCampaign(id, bytes32(0));
    }

    /// @notice Approve with a human-confirmation attestation hash (e.g. hash of a fresh World ID proof/confirmation),
    ///         recorded on-chain. Mandatory when the campaign is high value.
    function approveCampaign(uint256 id, bytes32 attestation) external onlyAdmin {
        _approveCampaign(id, attestation);
    }

    function _approveCampaign(uint256 id, bytes32 attestation) internal {
        Campaign storage c = _campaigns[id];
        if (c.state != State.Funded) revert BadState(c.state);
        if (c.highValue && attestation == bytes32(0)) revert AttestationRequired();
        if (attestation != bytes32(0)) {
            approvalAttestation[id] = attestation;
            emit HumanAttested(id, msg.sender, attestation, 1);
        }
        c.state = State.Approved;
        treasuryAccrued += c.campaignerFee;
        emit CampaignApproved(id, msg.sender, c.campaignerFee);
    }

    /// @notice Admin rejects a funded campaign; the campaigner is refunded in full, fee included.
    function rejectCampaign(uint256 id) external onlyAdmin nonReentrant {
        Campaign storage c = _campaigns[id];
        if (c.state != State.Funded) revert BadState(c.state);
        c.state = State.Rejected;
        uint256 refund = c.grossFunded;
        usdc.safeTransfer(c.campaigner, refund);
        emit CampaignRejected(id, msg.sender, refund);
    }

    // --------------------------------------------------------- PerView mode
    /// @notice Called by the reporting adapter with a creator's cumulative verified views.
    ///         Credits only the delta since the last report, capped by the remaining pool.
    function reportViews(uint256 id, address creator, uint256 cumulativeViews) external {
        if (msg.sender != reportAdapter) revert NotAdapter();
        Campaign storage c = _campaigns[id];
        if (c.state != State.Approved) revert BadState(c.state);
        if (c.mode != Mode.PerView) revert BadMode();
        if (block.timestamp > c.deadline) revert DeadlinePassed();

        uint256 last = reportedViews[id][creator];
        if (cumulativeViews <= last) {
            emit ViewsReported(id, creator, last, 0, 0);
            return; // stale or duplicate report: idempotent no-op
        }
        uint256 delta = cumulativeViews - last;
        reportedViews[id][creator] = cumulativeViews;

        uint256 amount = (delta * c.ratePer1kViews) / 1000;
        uint256 remaining = c.pool - c.allocated;
        if (amount > remaining) amount = remaining;
        if (amount > 0) {
            c.allocated += amount;
            credited[id][creator] += amount;
            _pushTranche(id, creator, amount);
            emit CreatorCredited(id, creator, amount);
        }
        emit ViewsReported(id, creator, cumulativeViews, delta, amount);
    }

    // ------------------------------------------------------ HumanSplit mode
    /// @notice Approve a split. If requireAdminApproval is false, the campaigner or an admin finalizes alone.
    ///         If true, the campaigner AND an admin must each submit the identical split.
    ///         Submitting a different split replaces the pending one and resets approvals.
    ///         High-value campaigns must use the attestation overload (fresh human confirmation per approver).
    function approveSplit(uint256 id, address[] calldata creators, uint256[] calldata amounts) external {
        _approveSplit(id, creators, amounts, bytes32(0));
    }

    function approveSplit(uint256 id, address[] calldata creators, uint256[] calldata amounts, bytes32 attestation)
        external
    {
        _approveSplit(id, creators, amounts, attestation);
    }

    function _approveSplit(uint256 id, address[] calldata creators, uint256[] calldata amounts, bytes32 attestation)
        internal
    {
        Campaign storage c = _campaigns[id];
        if (c.state != State.Approved) revert BadState(c.state);
        if (c.mode != Mode.HumanSplit) revert BadMode();
        if (block.timestamp > c.deadline) revert DeadlinePassed();
        if (creators.length != amounts.length || creators.length == 0 || creators.length > MAX_BATCH) {
            revert BadParams();
        }
        bool asCampaigner = msg.sender == c.campaigner;
        bool asAdmin = isAdmin[msg.sender];
        if (!asCampaigner && !asAdmin) revert NotApprover();
        _attestSplit(id, c.highValue, attestation);

        uint256 total;
        for (uint256 i; i < amounts.length; ++i) {
            total += amounts[i];
        }
        if (total > c.pool - c.allocated) revert PoolExceeded();

        bytes32 h = keccak256(abi.encode(creators, amounts));
        PendingSplit storage p = pendingSplit[id];
        if (p.hash != h) {
            p.hash = h;
            p.byCampaigner = false;
            p.byAdmin = false;
            emit SplitProposed(id, msg.sender, h);
        }
        if (asCampaigner) p.byCampaigner = true;
        else p.byAdmin = true; // campaigner takes precedence if also an admin
        emit SplitApproved(id, msg.sender, h);

        bool ok = c.requireAdminApproval ? (p.byCampaigner && p.byAdmin) : true;
        if (!ok) return;

        delete pendingSplit[id];
        _creditSplit(id, creators, amounts);
        c.allocated += total;
        emit SplitFinalized(id, h, total);
    }

    function _attestSplit(uint256 id, bool highValue, bytes32 attestation) internal {
        if (highValue && attestation == bytes32(0)) revert AttestationRequired();
        if (attestation != bytes32(0)) {
            splitAttestation[id][msg.sender] = attestation;
            emit HumanAttested(id, msg.sender, attestation, 2);
        }
    }

    function _creditSplit(uint256 id, address[] calldata creators, uint256[] calldata amounts) internal {
        for (uint256 i; i < creators.length; ++i) {
            if (creators[i] == address(0)) revert BadParams();
            credited[id][creators[i]] += amounts[i];
            emit CreatorCredited(id, creators[i], amounts[i]);
        }
    }

    // ------------------------------------------------------- PoolShare mode
    /// @notice Campaigner or admin sets (replaces) creator weights. Payout is proportional at close.
    function setWeights(uint256 id, address[] calldata creators, uint256[] calldata w) external {
        Campaign storage c = _campaigns[id];
        if (c.state != State.Approved) revert BadState(c.state);
        if (c.mode != Mode.PoolShare) revert BadMode();
        if (msg.sender != c.campaigner && !isAdmin[msg.sender]) revert NotApprover();
        if (creators.length != w.length || creators.length > MAX_BATCH) revert BadParams();

        address[] storage old = _weightCreators[id];
        for (uint256 i; i < old.length; ++i) {
            weights[id][old[i]] = 0;
        }
        delete _weightCreators[id];

        uint256 total;
        for (uint256 i; i < creators.length; ++i) {
            if (creators[i] == address(0) || w[i] == 0 || weights[id][creators[i]] != 0) revert BadParams();
            weights[id][creators[i]] = w[i];
            _weightCreators[id].push(creators[i]);
            total += w[i];
        }
        totalWeight[id] = total;
        emit WeightsSet(id, msg.sender, creators.length, total);
    }

    // ---------------------------------------------------------------- close
    /// @notice Close a campaign. Campaigner may close after the deadline; an admin may close any time.
    ///         PoolShare: distributes the whole pool by weight (rounding dust is refunded).
    ///         All modes: unallocated pool returns to the campaigner. Creator credits stay claimable.
    function closeCampaign(uint256 id) external nonReentrant {
        Campaign storage c = _campaigns[id];
        if (c.state != State.Approved) revert BadState(c.state);
        if (msg.sender == c.campaigner) {
            if (block.timestamp <= c.deadline && !isAdmin[msg.sender]) revert DeadlineNotReached();
        } else if (!isAdmin[msg.sender]) {
            revert NotCampaigner();
        }
        c.state = State.Closed;

        if (c.mode == Mode.PoolShare && totalWeight[id] > 0) {
            address[] storage list = _weightCreators[id];
            uint256 tw = totalWeight[id];
            uint256 pool = c.pool;
            uint256 distributed;
            for (uint256 i; i < list.length; ++i) {
                uint256 share = (pool * weights[id][list[i]]) / tw;
                distributed += share;
                credited[id][list[i]] += share;
                emit CreatorCredited(id, list[i], share);
            }
            c.allocated += distributed;
        }

        uint256 refund = c.pool - c.allocated;
        if (refund > 0) usdc.safeTransfer(c.campaigner, refund);
        emit CampaignClosed(id, msg.sender, refund);
    }

    // ---------------------------------------------------------------- claim
    /// @notice Creator pulls everything credited so far, minus the creator-side fee.
    ///         PoolShare credits exist only after close; other modes are claimable while Approved or Closed.
    function claim(uint256 id) external nonReentrant returns (uint256 net) {
        Campaign storage c = _campaigns[id];
        if (c.state != State.Approved && c.state != State.Closed) revert BadState(c.state);
        uint256 gross;
        if (c.mode == Mode.PerView) {
            _release(id, msg.sender);
            gross = _released[id][msg.sender] - claimed[id][msg.sender];
        } else {
            gross = credited[id][msg.sender] - claimed[id][msg.sender];
        }
        if (gross == 0) revert NothingToClaim();
        claimed[id][msg.sender] += gross;

        uint256 fee = (gross * c.creatorFeeBps) / 10_000;
        net = gross - fee;
        treasuryAccrued += fee;
        usdc.safeTransfer(msg.sender, net);
        emit Claimed(id, msg.sender, gross, fee, net);
    }

    // ---------------------------------------------------------------- views
    function getCampaign(uint256 id) external view returns (Campaign memory) {
        return _campaigns[id];
    }

    /// @notice Gross amount the creator can claim right now (PerView: only credits past the retention window).
    function claimable(uint256 id, address creator) external view returns (uint256) {
        if (_campaigns[id].mode == Mode.PerView) {
            (uint256 matured,) = _maturedTranches(id, creator);
            return _released[id][creator] + matured - claimed[id][creator];
        }
        return credited[id][creator] - claimed[id][creator];
    }

    /// @notice Total credited but not yet claimed, including credits still inside the retention window.
    function pendingTotal(uint256 id, address creator) external view returns (uint256) {
        return credited[id][creator] - claimed[id][creator];
    }

    /// @notice PerView tranches (timestamp, gross amount) for a creator; each matures at `at + retentionPeriod`.
    function tranches(uint256 id, address creator) external view returns (Tranche[] memory) {
        return _tranches[id][creator];
    }

    /// @dev Same-UTC-day credits share one tranche stamped with the latest credit time (never matures early).
    function _pushTranche(uint256 id, address creator, uint256 amount) internal {
        Tranche[] storage t = _tranches[id][creator];
        uint256 n = t.length;
        if (n > 0 && n > _nextTranche[id][creator] && t[n - 1].at / 1 days == block.timestamp / 1 days) {
            t[n - 1].amount += uint192(amount);
            t[n - 1].at = uint64(block.timestamp);
        } else {
            t.push(Tranche(uint64(block.timestamp), uint192(amount)));
        }
    }

    function _maturedTranches(uint256 id, address creator) internal view returns (uint256 sum, uint256 next) {
        Tranche[] storage t = _tranches[id][creator];
        next = _nextTranche[id][creator];
        uint64 ret = retentionPeriod;
        while (next < t.length && uint256(t[next].at) + ret <= block.timestamp) {
            sum += t[next].amount;
            ++next;
        }
    }

    function _release(uint256 id, address creator) internal {
        (uint256 sum, uint256 next) = _maturedTranches(id, creator);
        _released[id][creator] += sum;
        _nextTranche[id][creator] = next;
    }

    function remainingPool(uint256 id) external view returns (uint256) {
        Campaign storage c = _campaigns[id];
        return c.pool - c.allocated;
    }

    function weightCreators(uint256 id) external view returns (address[] memory) {
        return _weightCreators[id];
    }
}
