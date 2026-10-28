# Local end-to-end money-flow test (`npm run e2e:chain`)

Proves contracts + backend indexer + CRE-style report delivery work together on a local chain, with no external credentials.

```
export PATH="$HOME/.foundry/bin:$PATH"     # forge + anvil
cd web && npm run e2e:chain                # ~1-2 min, exits non-zero on any failure
```

## What it boots (all on free ports; anvil prefers 8546)
| Piece | How |
|---|---|
| Chain | `anvil --chain-id 31337` (fresh each run) |
| Contracts | the real `contracts/script/DeployMock.s.sol` (USDC) + `Deploy.s.sol` with `ALLOW_ANY_CHAIN=true`: escrow, report receiver, referral, creator profile. Receiver runs in **strict** mode (`EXPECTED_WORKFLOW_OWNER` set, no `INSECURE_SKIP_WORKFLOW_CHECK`); admin != deployer so ownership transfer is exercised |
| DB | in-memory PGlite Postgres + `prisma migrate deploy` (never touches `.pgdata`) |
| Backend | `next dev` (`NEXT_DIST_DIR=.next-e2e`) with `ARC_RPC_URL`, `ARC_CHAIN_ID=31337`, `ESCROW_ADDRESS`, ... pointing at anvil |
| External services | explicit **test doubles** (World ID, AI verifier/wizard, YouTube, chain signer) enabled by `CLIPPO_E2E_DOUBLES=1`, see below. The chain, SIWE, indexer, snapshots and fees are all real |

Report delivery: the script reads `GET /api/snapshots/latest`, ABI-encodes `(uint256 campaignId,address creator,uint256 cumulativeViews)[]` (same encoding as `cre/workflows/clippo-settlement/snapshot.ts`) and calls `ClippoReportReceiver.onReport(metadata, report)` from the forwarder address via `anvil_impersonateAccount`, with KeystoneForwarder-style 64-byte metadata (workflowId | name | owner | reportId).

## Test-double switch (impossible in production)
`web/src/instrumentation.ts` installs `web/src/test/e2e-doubles.ts` only when `CLIPPO_E2E_DOUBLES=1`. Under `NODE_ENV=production` the server **refuses to boot** with that flag, and `setOverride()` itself throws in production (unit test: `src/instrumentation.test.ts`). The YouTube double reads views / "clip gone" from a JSON control file (`E2E_CONTROL_FILE`) that the script rewrites between steps.

## Scenarios and results (last run: 48 passed, 0 failed)
Balances (USDC, 6 decimals) of campaigners, creators, treasury and escrow, plus `treasuryAccrued`, are asserted exactly after every money-moving step via a JS ledger.

| Scenario | Step | Result |
|---|---|---|
| 0. deployment | contracts deployed with expected wiring (owner=admin, forwarder, adapter, fees, retention) | PASS |
| 0. deployment | test doubles are active only via the explicit switch (World ID double accepts a proof) | PASS |
| 0. deployment | mint test USDC to campaigners; all balances exact | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | campaigner SIWE sign-in (CAMPAIGNER) + wizard suggests a story | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | create DRAFT campaign (pool 100 USDC, 10 USDC / 1k views) | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | fund preview fee == on-chain fee; createCampaign on-chain (approve+create); backend verifies receipt | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | replayed fund call is idempotent; funding a 2nd time is refused | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | backend refuses approve before the on-chain approve (409 CHAIN_STATE_MISMATCH); non-admin 403 | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | admin on-chain approve -> treasury accrues the campaigner fee; backend verifies | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | creator A signs up (SIWE + World ID double), proves channel, submits clip -> verdict APPROVE | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | snapshots: refresh -> GET /api/snapshots/latest carries {onchainId, wallet, 4000} | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | receiver auth: a non-forwarder (NotForwarder) and a foreign workflow owner (InvalidWorkflowOwner) are refused | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | report #1 via receiver as forwarder: credits 40 USDC (4000 views), escrow state exact | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | indexer: sync creates the payout (40 USDC, releaseAt = block time + 7d); rerun is idempotent | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | claim inside the retention window reverts on-chain (NothingToClaim); balances unchanged | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | report #2 (7000 views): only the delta (3000 -> +30 USDC) is credited | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | duplicate report ignored (same cumulative) and stale report ignored (5000 < 7000) | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | a report for a missing campaign fails ONLY that item (ItemFailed), the rest of the batch lands | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | campaigner cannot close before the deadline (DeadlineNotReached) | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | retention window passes (anvil +7d): creator claims 70 USDC gross -> fee 0.175, net 69.825 | PASS |
| 1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close) | deadline passes; campaigner closes -> unspent 29.75 USDC returned; indexer/DB CLOSED | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | create + fund 2000 USDC HUMAN_SPLIT (CAMPAIGNER_AND_ADMIN) -> flagged highValue (net 1995 > 1000) | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | high-value approve WITHOUT attestation reverts on-chain (AttestationRequired) | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | admin human confirmation: denied proof 403, fresh proof ok, replayed proof 409 PROOF_REUSED | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | admin approveCampaign(id, attestation) on-chain; backend verifies attestation matches (HumanAttested) | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | creators A and B have approved clips in the campaign | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | API refuses splits above the pool (400 EXCEEDS_POOL) and recipients without an approved clip (400 BAD_RECIPIENT) | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | campaigner approves split 1000/500 (fresh proof) -> PENDING, awaiting admin; on-chain credits NOTHING yet | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | admin approves the identical split (fresh proof) -> AWAITING_CHAIN; on-chain finalises + credits | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | indexer: SplitFinalized + CreatorCredited -> payouts 1000 / 500, proposal no longer pending | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | A and B claim (no retention for splits): fees 2.5 / 1.25 USDC to treasury, exact nets | PASS |
| 2. HUMAN_SPLIT high-value, campaigner + admin approvals | admin closes early: unallocated 495 USDC returned to the campaigner; backend CLOSED | PASS |
| 3. POOL_SHARE (weights from views, distribution at close) | create + fund 300 USDC POOL_SHARE (VIEWS); admin approves (non high-value) | PASS |
| 3. POOL_SHARE (weights from views, distribution at close) | A and B submit clips; snapshots 3000 / 1000 views appear in the feed | PASS |
| 3. POOL_SHARE (weights from views, distribution at close) | a PER_VIEW report for a POOL_SHARE campaign is rejected by the escrow (BadMode) without blocking the batch | PASS |
| 3. POOL_SHARE (weights from views, distribution at close) | campaigner sets weights 3000:1000 on-chain; stranger cannot (NotApprover) | PASS |
| 3. POOL_SHARE (weights from views, distribution at close) | deadline passes; campaigner closes: whole pool distributed 3:1, rounding dust refunded (exact) | PASS |
| 3. POOL_SHARE (weights from views, distribution at close) | indexer credits payouts; both claim after close (creator-side fee floors like the contract) | PASS |
| 4. Rejection with full refund | fund 100 USDC then admin rejects on-chain: campaigner refunded in full INCLUDING the fee | PASS |
| 4. Rejection with full refund | a rejected campaign cannot be approved/closed/reported/claimed; treasury got no fee | PASS |
| 5. Claim frozen by fraud flag (deleted clip) refused at API | fund 50 USDC PER_VIEW, approve, clip approved, 2000 views reported -> 20 USDC credited, payout synced | PASS |
| 5. Claim frozen by fraud flag (deleted clip) refused at API | clip deleted: refresh freezes the payout, opens a CLIP_DELETED flag, and drops the clip from the feed | PASS |
| 5. Claim frozen by fraud flag (deleted clip) refused at API | claim preview says frozen/not claimable; POST claim is refused 409 PAYOUT_FROZEN | PASS |
| 5. Claim frozen by fraud flag (deleted clip) refused at API | admin DISMISSes the flag (clip public again) -> payout unfrozen | PASS |
| 5. Claim frozen by fraud flag (deleted clip) refused at API | pool cap: 5000 views would be +30 USDC but only the 29.875 left in the pool is credited (delta within cap) | PASS |
| 5. Claim frozen by fraud flag (deleted clip) refused at API | retention passes; claim 49.875 USDC on-chain (fee floors) and API records it fully; admin closes, refund 0 | PASS |
| 6. Fees land at the treasury; escrow fully drained | withdrawFees (permissionless): treasury receives exactly campaigner + creator fees; escrow balance is 0 | PASS |
| 6. Fees land at the treasury; escrow fully drained | backend indexer in sync with chain: a full re-sync applies nothing new, no campaign stuck | PASS |

## Bugs found and fixed by this test (backend, not contracts)
1. **Claim recorded before earlier credits were indexed dropped the remainder** (`lib/chain/indexer.ts`): a `Claimed` event is applied against payouts built from `CreatorCredited`. If the periodic sync lagged, the DB showed `claimedAmount 40` for an on-chain claim of 70, and the later credit then re-opened as "unclaimed". `processReceipt` now catches the indexer up (`syncChain`) before applying a receipt that contains `Claimed`.
2. **Stale head in `syncChain`**: viem caches `getBlockNumber` for ~4 s, so a just-mined tx could be skipped by `/api/chain/sync`. Now `getBlockNumber({ cacheTime: 0 })`.
3. **High-value approve without `txHash`** (`lib/chain/guards.ts`): `assertOnchainState` did not index anything, so `/campaigns/:id/approve` answered `409 ATTESTATION_MISMATCH` until the next sync (the UI passes a txHash, other clients may not). It now syncs when no txHash is given.

## Not tested / limitations
- World ID, AI (Anthropic/Gemini), YouTube Data API, Transak, Instagram/X are doubles; real credentials/providers are not exercised.
- The real Chainlink CRE simulator / DON signatures and the real KeystoneForwarder are not used (forwarder is impersonated); the `/api/snapshots/daily` frozen feed is not exercised.
- No browser/wallet UI (the script plays the same calls `lib/chain/client.ts` makes, with viem accounts).
- Anvil time travel moves chain time but not the server wall clock. The claim *preview* `claimable` flag (which compares `releaseAt` with `Date.now()`) therefore stays false after a warp; only the on-chain claim and `POST /claim` are asserted. In production both clocks agree. The script also sets the on-chain deadline from chain time rather than the preview's wall-clock deadline for the same reason.
- A deleted-clip freeze is enforced at the API only: the contract still lets the creator claim matured credits directly (known, documented design: the retention window is the protection).
- Anomaly (view spike) holds are disabled (`ANOMALY_MIN_DELTA` huge) to keep numbers deterministic; they have their own unit tests. Referral and creator-profile contracts are deployed and checked for code only.
- PoolShare weights are set directly on-chain by the campaigner (there is no API route for `setWeights`).
