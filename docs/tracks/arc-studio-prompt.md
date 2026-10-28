# Arc Studio prompt and import kit for the Clippo escrow

Goal: show Studio generating and testing the escrow, then pin Clippo's reviewed version. Studio deploys to Arc testnet only (https://docs.arc.io/ai/arc-studio.md).

## Option A, web (https://studio.arc.io/)
1. New project, paste the prompt below.
2. When Studio produces its contract, paste `contracts/src/ClippoEscrow.sol` (and `contracts/src/MockUSDC.sol` for the sandbox) and ask: "Replace your escrow with this contract, compile it, and run these tests." Paste `contracts/test/ClippoEscrow.t.sol` if Studio runs Foundry tests (UNVERIFIED); otherwise ask it to exercise the flows in the sandbox with real testnet transactions.
3. Deploy to Arc testnet from Studio, record the Studio project URL and address. Push to GitHub from Studio if wanted.

## Option B, CLI
```bash
npm install -g @circle-fin/arc-studio-cli   # Node 20+
arc-studio login
arc-studio run "<paste the prompt below>" \
  --file contracts/src/ClippoEscrow.sol --file contracts/test/ClippoEscrow.t.sol --output json
arc-studio deployments
arc-studio pull --out ./onchain --paths "contracts/**"
```

## Prompt
```text
Build a USDC escrow for a clipping-campaign marketplace on Arc testnet.

Token: USDC at 0x3600000000000000000000000000000000000000. Use ONLY the ERC-20 interface, which has 6 decimals (the native gas balance has 18; never mix them). The constructor must revert if decimals() != 6. Use SafeERC20 and ReentrancyGuard; creators pull payouts.

Roles: owner, admins (owner-managed), campaigner (funds a campaign), creators (earn), a reportAdapter address (only caller of reportViews), a treasury.

Lifecycle: Funded -> Approved (admin) -> Closed, or Funded -> Rejected (admin; refunds the full gross including fee). createCampaign(mode, ratePer1kViews, poolAmount, deadline, requireAdminApproval, metadataURI) pulls poolAmount; the campaigner fee (bps of poolAmount) is held in escrow and only accrues to the treasury on approval. Nothing can be credited or claimed before approval.

Three modes:
1. PerView: reportViews(id, creator, cumulativeViews) from the adapter credits (delta * ratePer1kViews / 1000), capped at the remaining pool, ignores non-increasing reports, rejected after the deadline. Credits mature after a retention period (default 7 days, max 30) before they are claimable.
2. HumanSplit: approveSplit(id, creators[], amounts[]) by campaigner or admin; sum <= remaining pool; if requireAdminApproval both campaigner and an admin must submit the identical split (a different split resets approvals).
3. PoolShare: setWeights(id, creators[], weights[]); at closeCampaign the pool is split pro rata, rounding dust refunded to the campaigner, no weights means full refund; claims open after close.

Fees: two-sided, in bps, owner-set, hard cap 50 bps each (default 25/25), snapshotted per campaign. The creator fee is deducted from the gross at claim(). withdrawFees() sends accrued fees to the treasury.

Refunds: closeCampaign by the campaigner only after the deadline (admin any time) returns the unallocated pool to the campaigner; creator credits stay claimable.

High-value campaigns (pool above an owner-set threshold, default 1000 USDC) require a bytes32 human-attestation argument on approval and split approval and emit HumanAttested.

Add events for every state change, custom errors, and views getCampaign, claimable, remainingPool. Write Foundry tests covering all three modes, fee math at 0 and 50 bps, rejection refund, deadline refund, pool cap, reentrancy, access control, and a fuzz test that total paid out never exceeds funded.
```

## Local reference
Final Solidity: `contracts/src/ClippoEscrow.sol`. Tests: `contracts/test/ClippoEscrow.t.sol`. ABI: `contracts/abi/ClippoEscrow.json`. Run `cd contracts && forge test`.
