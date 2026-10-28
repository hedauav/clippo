// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ClippoReferral
/// @notice OPTIONAL MODULE, off by default (see LEGAL_REVIEW.md). A referrer who shares a campaign earns a capped
///         cut of the activity (USDC fees/spend) that campaign brings in. Rewards are paid from a separately
///         funded reward pool and are pull-claimed. This contract never touches escrow funds.
///         Fraud limits: referee must be an attested unique human, one referrer per referee (first wins),
///         no self-referral, per-referrer lifetime cap, cooldown between credits, per-referrer freeze, global pause.
contract ClippoReferral is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_CUT_BPS = 1000; // 10%

    IERC20 public immutable usdc;

    uint256 public cutBps;
    uint256 public perReferrerCap; // lifetime credit cap per referrer (USDC, 6 decimals)
    uint64 public cooldown; // seconds between credits to the same referrer
    bool public paused;

    mapping(address => bool) public recorders; // backend / CRE addresses allowed to record
    mapping(address => bool) public guardians; // may freeze referrers
    mapping(address => bool) public uniqueHuman; // referee attestation (World ID verified off-chain)

    mapping(address => address) public referrerOf; // referee => referrer
    mapping(address => uint256) public campaignOf; // referee => campaign it came through
    mapping(address => bool) public frozen; // referrer => frozen
    mapping(address => uint256) public credited; // lifetime credited per referrer
    mapping(address => uint256) public claimed;
    mapping(address => uint64) public lastCreditAt;
    mapping(address => uint256) public refereeCount;

    uint256 public totalOwed; // credited - claimed across all referrers
    uint256 public totalFunded;

    event RecorderSet(address indexed who, bool allowed);
    event GuardianSet(address indexed who, bool allowed);
    event HumanSet(address indexed referee, bool human);
    event ParamsSet(uint256 cutBps, uint256 perReferrerCap, uint64 cooldown);
    event Paused(bool paused);
    event Funded(address indexed from, uint256 amount);
    event ReferralRegistered(address indexed referrer, address indexed referee, uint256 indexed campaignId);
    event Credited(
        address indexed referrer, address indexed referee, uint256 indexed campaignId, uint256 activity, uint256 amount
    );
    event Frozen(address indexed referrer, bool frozen);
    event Claimed(address indexed referrer, uint256 amount);

    error NotRecorder();
    error NotGuardian();
    error IsPaused();
    error BadParams();
    error SelfReferral();
    error AlreadyReferred();
    error NotHuman();
    error NotReferred();
    error ReferrerFrozen();
    error CooldownActive();
    error CapReached();
    error NothingToClaim();
    error Underfunded();

    constructor(address usdc_, address owner_, uint256 cutBps_, uint256 perReferrerCap_, uint64 cooldown_)
        Ownable(owner_)
    {
        if (usdc_ == address(0)) revert BadParams();
        usdc = IERC20(usdc_);
        _setParams(cutBps_, perReferrerCap_, cooldown_);
    }

    modifier onlyRecorder() {
        if (!recorders[msg.sender]) revert NotRecorder();
        _;
    }

    modifier whenActive() {
        if (paused) revert IsPaused();
        _;
    }

    // ---- admin ----
    function setRecorder(address who, bool allowed) external onlyOwner {
        recorders[who] = allowed;
        emit RecorderSet(who, allowed);
    }

    function setGuardian(address who, bool allowed) external onlyOwner {
        guardians[who] = allowed;
        emit GuardianSet(who, allowed);
    }

    function setParams(uint256 cutBps_, uint256 perReferrerCap_, uint64 cooldown_) external onlyOwner {
        _setParams(cutBps_, perReferrerCap_, cooldown_);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice Freeze/unfreeze a referrer (owner or guardian). Frozen referrers cannot earn or claim.
    function setFrozen(address referrer, bool f) external {
        if (msg.sender != owner() && !guardians[msg.sender]) revert NotGuardian();
        frozen[referrer] = f;
        emit Frozen(referrer, f);
    }

    function _setParams(uint256 cutBps_, uint256 cap_, uint64 cooldown_) internal {
        if (cutBps_ > MAX_CUT_BPS || cap_ == 0) revert BadParams();
        cutBps = cutBps_;
        perReferrerCap = cap_;
        cooldown = cooldown_;
        emit ParamsSet(cutBps_, cap_, cooldown_);
    }

    // ---- funding ----
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadParams();
        totalFunded += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ---- attestation + attribution ----
    /// @notice Attest that a referee wallet is a unique human (backend sets after World ID verification).
    function setUniqueHuman(address referee, bool human) external onlyRecorder {
        uniqueHuman[referee] = human;
        emit HumanSet(referee, human);
    }

    /// @notice Bind a referee to a referrer through a shared campaign. First attribution wins.
    function registerReferral(address referrer, address referee, uint256 campaignId) external onlyRecorder whenActive {
        if (referrer == address(0) || referee == address(0)) revert BadParams();
        if (referrer == referee) revert SelfReferral();
        if (referrerOf[referee] != address(0)) revert AlreadyReferred();
        if (!uniqueHuman[referee]) revert NotHuman();
        if (referrerOf[referrer] == referee) revert SelfReferral(); // no 2-cycles
        referrerOf[referee] = referrer;
        campaignOf[referee] = campaignId;
        ++refereeCount[referrer];
        emit ReferralRegistered(referrer, referee, campaignId);
    }

    /// @notice Credit the referrer of `referee` a capped cut of `activity` (USDC amount of activity brought in).
    /// @return credit amount actually credited
    function recordActivity(address referee, uint256 activity)
        external
        onlyRecorder
        whenActive
        returns (uint256 credit)
    {
        address referrer = referrerOf[referee];
        if (referrer == address(0)) revert NotReferred();
        if (frozen[referrer]) revert ReferrerFrozen();
        if (!uniqueHuman[referee]) revert NotHuman();
        uint64 last = lastCreditAt[referrer];
        if (last != 0 && block.timestamp < uint256(last) + cooldown) revert CooldownActive();

        credit = (activity * cutBps) / 10_000;
        uint256 room = perReferrerCap > credited[referrer] ? perReferrerCap - credited[referrer] : 0;
        if (credit > room) credit = room;
        if (credit == 0) revert CapReached();
        if (totalOwed + credit > usdc.balanceOf(address(this))) revert Underfunded();

        credited[referrer] += credit;
        totalOwed += credit;
        lastCreditAt[referrer] = uint64(block.timestamp);
        emit Credited(referrer, referee, campaignOf[referee], activity, credit);
    }

    // ---- claim ----
    function claimable(address referrer) public view returns (uint256) {
        return frozen[referrer] ? 0 : credited[referrer] - claimed[referrer];
    }

    function claim() external nonReentrant returns (uint256 amount) {
        if (frozen[msg.sender]) revert ReferrerFrozen();
        amount = credited[msg.sender] - claimed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimed[msg.sender] += amount;
        totalOwed -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @notice Owner may recover unowed USDC (e.g. unspent reward pool). Never touches owed amounts.
    function recoverUnowed(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > usdc.balanceOf(address(this)) - totalOwed) revert Underfunded();
        usdc.safeTransfer(to, amount);
    }
}
