# Clippo API

Base path: `/api`. All bodies/responses are JSON. Enums are UPPER_CASE strings. Timestamps are ISO strings. Money is USDC as a JSON number.

## Conventions

**Errors** (any non-2xx): `{ "error": { "code": string, "message": string, "issues"?: ZodIssue[] } }`
Common codes: `BAD_REQUEST`(400, has `issues`), `BAD_JSON`, `UNAUTHENTICATED`(401), `FORBIDDEN`(403), `NOT_FOUND`(404), `BAD_STATE`(409), `INTERNAL`(500).

**Session** (wallet-signature sign-in; SIWE / EIP-4361 over viem):
1. `GET /api/auth/nonce` returns a single-use nonce (10 min). The wallet signs the EIP-4361 message built from it (domain = `SIWE_DOMAIN` or the request Host; helper: `signIn()` in `src/lib/chain/client.ts`).
2. `POST /api/auth/session {message, signature, role?}` verifies signature, domain, expiry and consumes the nonce, upserts the user and returns `{token, user}` and sets HttpOnly cookie `clippo_session` (7 days, HMAC-signed with `SESSION_SECRET`, which is required in production).
3. Authenticate later requests by the cookie (automatic from the browser) or `Authorization: Bearer <token>`.
4. **Dev bypass (only when `NODE_ENV != production`)**: `POST /api/auth/session {wallet, role}` without a signature, and the `x-wallet: <address>` header. In production both are refused (401 `SIGNATURE_REQUIRED`); `ALLOW_WALLET_HEADER` no longer re-enables them.
5. Wallets are lower-cased. A wallet listed in `ADMIN_WALLETS` always becomes `ADMIN`. Otherwise role is chosen at first sign-in (`CAMPAIGNER` | `CREATOR`) and is fixed.

**Chain mode.** The API verifies on-chain facts instead of trusting clients: fund, claim, approve, reject, close and split-finalisation only take effect when the escrow's events/state (read via viem from `ARC_RPC_URL`) say so, and an indexer (`POST /api/chain/sync`, plus per-transaction receipt verification) updates the database. `ESCROW_ADDRESS` is required: without it these endpoints answer 503 `NOT_CONFIGURED` (there is no mirrored/mock mode and no `ALLOW_MOCK_CHAIN`).

Extra error codes: `SIGNATURE_REQUIRED`/`BAD_SIGNATURE`/`BAD_SIWE_MESSAGE`/`NONCE_INVALID`(401), `PROOF_REUSED`(409), `WORLD_ID_DENIED`(403), `HUMAN_CONFIRMATION_REQUIRED`(428), `CHAIN_NOT_CONFIGURED`(503), `TX_NOT_FOUND`(404), `TX_REVERTED`/`FUND_NOT_VERIFIED`/`CLAIM_NOT_VERIFIED`(422), `CHAIN_STATE_MISMATCH`/`ATTESTATION_MISMATCH`/`PAYOUT_FROZEN`/`ALREADY_APPROVED`(409).

**Roles** shown below as `[creator]`, `[campaigner]`, `[admin]`, `[public]`, `[any]` (any signed-in user).

## Shared shapes

```ts
User      { id, role: "CAMPAIGNER"|"CREATOR"|"ADMIN", wallet, worldIdNullifier: string|null, verified: boolean, createdAt }
Story     { summary, topic, requiredPoints: string[], prohibitedClaims: string[], disclosureLabel: string, attribution: string, description?: string }
Campaign  { id, campaignerId, title, story: Story, contentSource: "UPLOAD"|"LINK"|"AI_GENERATED", contentUrl: string|null,
            platforms: ("YOUTUBE"|"X"|"INSTAGRAM")[], payoutMode: "PER_VIEW"|"HUMAN_SPLIT"|"POOL_SHARE",
            poolShareBasis: "VIEWS"|"APPROVED_CLIPS"|null, approver: "CAMPAIGNER_ONLY"|"CAMPAIGNER_AND_ADMIN"|null,
            poolSize: number, ratePer1k: number|null, viewTarget: number|null,
            eligibility: "ANYONE_VERIFIED"|"HIGHER_RANKED",
            status: "DRAFT"|"FUNDED"|"APPROVED"|"REJECTED"|"CLOSED",
            onchainId: string|null, fundTxHash: string|null, rejectReason: string|null,
            createdAt, updatedAt, submissionCount?: number }
Channel   { id, userId, platform: "YOUTUBE", handle, externalId: string|null, verificationCode, verified, createdAt }
Verdict   { id, submissionId, result: "APPROVE"|"REJECT"|"NEEDS_HUMAN", confidence: number /*0..1*/, reason: string,
            decidedBy: "AI"|"HUMAN", deciderId: string|null,
            appealStatus: "NONE"|"PENDING"|"UPHELD"|"OVERTURNED", appealNote: string|null,
            flags: string[]|null /* duplicate, near_duplicate, injection_suspected, low_confidence, unreadable, channel_mismatch, llm_error, bad_llm_output */,
            createdAt, updatedAt }
Submission{ id, campaignId, creatorId, channelId, link, videoId, transcript: string|null, transcriptHash,
            metadata: { title, description, views, publishedAt }, createdAt, verdict?: Verdict }
Payout    { id, campaignId, creatorId, amount, status: "PENDING"|"CLAIMED", claimTxHash: string|null, createdAt, claimedAt: string|null }
```

Campaign lifecycle: `DRAFT -> FUNDED` (campaigner) `-> APPROVED | REJECTED` (admin) `-> CLOSED` (campaigner/admin).

Chain-sourced additions (set from events/state, never from client claims): `Campaign` also has `highValue: boolean` (net pool above the high-value threshold: approval needs a fresh human attestation), `grossFunded`, `campaignerFee`, `campaignerFeeBps`, `creatorFeeBps` (fee snapshot, number|null), `approvalAttestation: string|null`. `Payout` also has `claimedAmount` (gross claimed on-chain), `releaseAt` (PER_VIEW retention: when the latest credit becomes claimable), `frozen`, `frozenReason`; in chain mode there is one aggregate payout per (campaign, creator) fed by `CreatorCredited` events and `amount` is gross (before the creator fee). `Submission` also has `clipStatus: "LIVE"|"DELETED"`, `deletedAt`.

---

## Auth

### GET /api/auth/nonce  `[public]`
Res 200: `{ "nonce", "domain", "uri", "chainId", "statement", "expiresAt" }`. Build the EIP-4361 message with these (address, nonce, domain, uri, chainId, statement, version "1", issuedAt, expirationTime <= expiresAt) and sign it.

### POST /api/auth/session  `[public]`
Req (production): `{ "message": string, "signature": "0x..", "role"?: "CAMPAIGNER"|"CREATOR" }` (`role` required for a new non-admin wallet)
Req (dev only, NODE_ENV != production): `{ "wallet": string, "role"?: ... }` with no signature
Res 200: `{ "token": string, "user": User }`. Errors: 401 `SIGNATURE_REQUIRED` (no signature in production), `BAD_SIWE_MESSAGE` (malformed/expired/wrong domain), `BAD_SIGNATURE`, `NONCE_INVALID` (unknown, expired or already used).

### GET /api/auth/me  `[public]`
Res 200: `{ "user": User | null }`

### POST /api/auth/logout  `[public]`
Res 200: `{ "ok": true }` (clears cookie)

## World ID

World ID 4.0 via the Developer Portal v4 verify API (`POST https://developer.world.org/api/v4/verify/{rp_id}`). Env: `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY`, `WORLD_ID_ACTION` (default `clippo-creator-signup`), `WORLD_ID_ENVIRONMENT` (default `production`; `staging` for the simulator). Without them every World ID endpoint answers 503 `NOT_CONFIGURED` ("not configured: set WORLD_ID_APP_ID"); there is no mock verifier.

A proof (`worldIdProof` / the body of /worldid/verify) is EITHER the complete IDKit 4.x result `{ protocol_version, nonce, action, environment, responses: [{ identifier, nullifier, proof, ... }] }` (forwarded unmodified; preferred) OR the legacy `{ nullifier_hash, proof, merkle_root?, verification_level?, signal? }` (mapped to a v3 request). Proofs whose `action` or `environment` differ from the server's are refused before any network call.

### POST /api/worldid/rp-signature  `[any signed-in]`
Signs the IDKit request context server-side (the signing key never leaves the server). Req: `{ "action"?: string }` (allowed: the sign-up action, `clippo-approve-campaign`, `clippo-approve-split`). Res 200: `{ "rpContext": { app_id, rp_id, action, environment, nonce, created_at, expires_at, signature } }`. Pass these to `IDKit.request({ app_id, action, rp_context: { rp_id, nonce, created_at, expires_at, signature }, ... })`.

### POST /api/worldid/verify  `[any signed-in, normally creator]`
Validates an IDKit proof server-side. Success sets `user.verified = true` and stores the nullifier (unique per human).
Req: a proof as above. Res 200: `{ "user": User, "mode": "real" }`.
Errors: 403 `WORLD_ID_DENIED` (cancelled/expired/invalid/wrong action), 409 `ALREADY_USED` (nullifier on another account), 503 `NOT_CONFIGURED`.

**Approvals (Agent Pass step, PRD 6.2).** `POST /api/campaigns/:id/attest` (action `clippo-approve-campaign`) and `POST /api/campaigns/:id/split` (action `clippo-approve-split`) need a FRESH proof per approver per action, bound by signal: `approve:<campaignId>` for attest and `split:<campaignId>:<splitHash>` for split (the proof's `signal_hash` must equal `hashSignal(signal)`; pass the same `signal` to IDKit). Create both actions in the Developer Portal with unlimited verifications. A proof is consumed once (409 `PROOF_REUSED`). The World "Agent Pass" OIDC step-up product (auth.world.org) is NOT implemented; the fresh IDKit proof is the human check.

## Wizard

### POST /api/wizard/suggest  `[campaigner|admin]`
Req: `{ "idea": string, "contentSource"?: "UPLOAD"|"LINK"|"AI_GENERATED", "platforms"?: Platform[], "payoutMode"?: PayoutMode, "poolShareBasis"?: ..., "approver"?: ..., "eligibility"?: ... }`
Res 200:
```json
{ "title": "string", "story": Story,
  "suggestions": [ { "label": "Starter", "poolSize": 500, "ratePer1k": 2, "viewTarget": 250000 } ],
  "aiMode": "real" }
```
`ratePer1k` is null unless `payoutMode` is `PER_VIEW`. Pass `title`, `story` and a chosen suggestion into `POST /api/campaigns`.

## Campaigns

### POST /api/campaigns  `[campaigner]`
Creates a `DRAFT`. Req:
```json
{ "title": "string", "story": Story, "contentSource": "LINK", "contentUrl": "string?",
  "platforms": ["YOUTUBE"], "payoutMode": "PER_VIEW|HUMAN_SPLIT|POOL_SHARE",
  "poolShareBasis": "VIEWS|APPROVED_CLIPS  (required for POOL_SHARE)",
  "approver": "CAMPAIGNER_ONLY|CAMPAIGNER_AND_ADMIN  (required for HUMAN_SPLIT)",
  "poolSize": 1000, "ratePer1k": 2 /* required for PER_VIEW */, "viewTarget": 500000,
  "eligibility": "ANYONE_VERIFIED|HIGHER_RANKED" }
```
Res 201: `{ "campaign": Campaign }`

### GET /api/campaigns  `[public]`
Query: `mine=true` (campaigner: own campaigns, all statuses; needs sign-in), `status=` (only with `mine=true` or as admin).
Default: only `APPROVED` campaigns (admin sees all). Res 200: `{ "campaigns": Campaign[] }` (with `submissionCount`).

### GET /api/campaigns/:id  `[public for APPROVED/CLOSED; owner/admin for others]`
Res 200: `{ "campaign": Campaign, "campaigner": {id, wallet, verified}, "performance": { "totalViews": number, "approvedClips": number, "viewTarget": number|null } }`

### GET /api/campaigns/:id/fund  `[campaigner, owner]`  (fund preview)
Res 200: `{ "campaign", "preview": { "poolAmount", "campaignerFeeBps", "campaignerFee", "netPool", "totalToApprove", "highValue" }, "fees": Fees, "chain": PublicChainConfig, "createCampaignArgs": { "mode": 0|1|2, "ratePer1kViews": "base units", "poolAmount": "base units", "deadline": unix, "requireAdminApproval": boolean, "metadataURI": "clippo://campaign/<id>" } }`.
The campaigner approves USDC for `totalToApprove`, then calls `createCampaign(...createCampaignArgs)` with exactly these arguments (the `metadataURI` links the event to this campaign). The campaigner-side fee is withheld from the pool: usable pool = `netPool`. Campaigns with `netPool` above the high-value threshold (default $1,000) are `highValue`.

### POST /api/campaigns/:id/fund  `[campaigner, owner]`
Records funding (DRAFT -> FUNDED). Req: `{ "txHash": string }` (the createCampaign transaction; verified against the receipt). Res 200: `{ "campaign": Campaign, "verified": true }`. 503 `NOT_CONFIGURED` without `ESCROW_ADDRESS`.
Chain mode: loads the receipt and requires a successful `CampaignCreated` from the escrow whose `metadataURI` is this campaign, whose funder is the owner's wallet, whose amount equals `poolSize` and whose mode/approver match; `onchainId`, fees and `highValue` come from the chain. Otherwise 422 `FUND_NOT_VERIFIED`. Replaying the same tx is idempotent.

### POST /api/campaigns/:id/attest  `[admin]`
Human confirmation for approving a FUNDED campaign (mandatory when `highValue`). Req: `{ "worldIdProof": { nullifier_hash, proof, merkle_root?, verification_level?, signal? } }`. Verifies a fresh, single-use World ID proof (one per approval) and returns `201 { "attestation": "0x<bytes32>", "highValue": boolean, "onchain": { "functionName": "approveCampaign", "args": [onchainId, attestation] } | null }`. Pass the attestation to the escrow's `approveCampaign(id, attestation)`; it is stored and emitted on-chain. Errors: 403 `WORLD_ID_DENIED` (cancelled/expired/invalid; nothing recorded), 409 `PROOF_REUSED` (replayed proof), 409 `BAD_STATE`.

### POST /api/campaigns/:id/approve  `[admin]`
FUNDED -> APPROVED. Req (optional): `{ "txHash"?: string }`. Res 200: `{ "campaign": Campaign }`.
Chain mode: the on-chain `approveCampaign` must already have happened (pass its `txHash` to index it immediately), else 409 `CHAIN_STATE_MISMATCH`. High-value campaigns additionally need a recorded `/attest` (428 `HUMAN_CONFIRMATION_REQUIRED` otherwise) and, in chain mode, the on-chain `approvalAttestation` must equal it (409 `ATTESTATION_MISMATCH`).

### POST /api/campaigns/:id/reject  `[admin]`
DRAFT|FUNDED -> REJECTED. Req: `{ "reason": string, "txHash"?: string }`. Res 200: `{ "campaign": Campaign, "refund": { "amount", "includesFee": true, "onchain": boolean } | null }`.
A funded campaign is refunded in full (pool + campaigner fee) by the escrow's `rejectCampaign`; in chain mode that call must already have happened (409 `CHAIN_STATE_MISMATCH` otherwise). A never-funded DRAFT is rejected in the database only. High-value campaigns can be rejected without attestation.

### POST /api/campaigns/:id/close  `[campaigner owner|admin]`
APPROVED -> CLOSED. Req (optional): `{ "txHash"?: string }`. Res 200: `{ "campaign": Campaign }`. Chain mode: on-chain `closeCampaign` must already have happened.

### GET /api/campaigns/:id/submissions  `[any signed-in]`
Campaigner owner/admin: all submissions; creators: only their own.
Res 200: `{ "submissions": (Submission & { verdict: Verdict|null, creator: {id, wallet} })[] }`

### POST /api/campaigns/:id/split  `[campaigner owner|admin]`
HUMAN_SPLIT only, campaign APPROVED. Called once per approver, each with their OWN fresh World ID proof (Agent Pass; one use per proof, PRD 6).
Req: `{ "splits": [ { "creatorWallet": string, "amount": number } ], "worldIdProof": { "nullifier_hash", "proof", "merkle_root"?, "verification_level"?, "signal"? } }`
Res 201:
```json
{ "payouts": [Payout],            // created only when the approvals are complete (and, in chain mode, never here: see AWAITING_CHAIN)
  "proposal": { "id", "status": "PENDING|AWAITING_CHAIN|FINALIZED", "splitHash": "0x..", "twoParty": true,
                "approvals": { "campaigner": true, "admin": false }, "awaiting": ["admin"] },
  "attestation": "0x<bytes32>",
  "onchain": { "functionName": "approveSplit", "args": { "id": "onchainId", "creators": ["0x.."], "amounts": ["base units"], "attestation": "0x.." } } | null }
```
- The split is canonicalised (wallets lower-cased and sorted, duplicates merged, micro-USDC) and hashed exactly like the contract (`keccak256(abi.encode(creators, amounts))`); "identical split" is therefore order-insensitive. Send `onchain.args` to `approveSplit(id, creators, amounts, attestation)` from the approver's wallet.
- `approver = CAMPAIGNER_AND_ADMIN`: status stays `PENDING` until the campaigner AND an admin each approved the identical split. A different split replaces the pending one (old -> SUPERSEDED) and clears the other approval, as in the contract. `CAMPAIGNER_ONLY`: a single approval finalises.
- Finalisation: without a chain (dev) payouts are created at once (`FINALIZED`). With a chain the proposal becomes `AWAITING_CHAIN` and payouts are created by the indexer from the on-chain credits when `SplitFinalized` is seen.
- Failure paths leave the action undone and do not consume the proof: cancelled/expired/invalid proof -> 403 `WORLD_ID_DENIED`; reused or `"repeated"` proof -> 409 `PROOF_REUSED`; same approver again with the same split -> 409 `ALREADY_APPROVED`; 400 `EXCEEDS_POOL` (against the net pool); 400 `BAD_RECIPIENT` (no live approved clip, or not an address in chain mode).
- Proofs are made unique per approval by hashing `(proof, nullifier_hash, merkle_root)`; real World ID actions must allow repeated verifications (unlimited) because the freshness is enforced here.

## Channels (ownership proof)

### POST /api/channels  `[creator]`
Req: `{ "platform": "YOUTUBE", "handle": string }` (leading `@` optional)
Res 201 (200 if already exists for you): `{ "channel": Channel }`. Tell the creator to put `channel.verificationCode` in their channel bio/description.
Errors: 409 `CHANNEL_TAKEN`.

### GET /api/channels  `[creator]`
Res 200: `{ "channels": Channel[] }`

### POST /api/channels/:id/verify  `[creator]`
Checks the code is in the channel bio. Res 200: `{ "channel": Channel }` (verified true). Error 422 `CODE_NOT_FOUND`.

## Submissions and verdicts

### POST /api/submissions  `[creator, World-ID verified]`
Fetches transcript/metadata, runs the AI verifier, stores the verdict.
Req: `{ "campaignId": string, "channelId": string, "link": "https://youtu.be/<id> | https://www.youtube.com/watch?v=<id> | /shorts/<id>" }`
Res 201: `{ "submission": Submission /* includes verdict */, "verdict": Verdict }`
Errors: 403 `NOT_VERIFIED`, 403 `CHANNEL_UNVERIFIED`, 403 `NOT_ELIGIBLE` (HIGHER_RANKED needs 3+ approved clips), 404 campaign not APPROVED, 400 `UNSUPPORTED_PLATFORM`/`BAD_LINK`, 409 `DUPLICATE_LINK`, 422 `VIDEO_UNREADABLE`.
Verdict rules: channel not owned -> REJECT; transcript unavailable -> NEEDS_HUMAN; exact duplicate transcript -> REJECT; near-duplicate or suspected prompt injection can never auto-APPROVE (-> NEEDS_HUMAN); confidence below `VERIFIER_CONFIDENCE_THRESHOLD` (default 0.75) -> NEEDS_HUMAN.

### GET /api/submissions  `[creator]`
Res 200: `{ "submissions": (Submission & { verdict, campaign: {id, title, status} })[] }`

### GET /api/submissions/:id  `[creator owner | campaigner owner | admin]`
Res 200: `{ "submission": Submission & { verdict, campaign: {id, title, campaignerId} } }`

### POST /api/submissions/:id/appeal  `[creator owner]`
Only for `REJECT` verdicts, once. Req: `{ "note": string }`. Res 200: `{ "verdict": Verdict }` (`appealStatus: "PENDING"`).

### POST /api/submissions/:id/verdict  `[campaigner owner|admin]`
Human override / resolves NEEDS_HUMAN and appeals. Req: `{ "result": "APPROVE"|"REJECT", "reason": string }`.
Res 200: `{ "verdict": Verdict }` (`decidedBy: "HUMAN"`; a pending appeal becomes `UPHELD` if REJECT else `OVERTURNED`).

## Views / settlement feed

### GET /api/snapshots/latest  `[public, read-only]`  (consumed by the Chainlink CRE workflow)
Res 200 (bare array, not wrapped):
```json
[ { "campaignId": "7", "creator": "0xwallet", "cumulativeViews": 12345 } ]
```
`campaignId` is the NUMERIC on-chain escrow id (uint256 as a decimal string), never the internal id. Campaigns without an `onchainId` are skipped. One entry per (on-chain campaign, creator) for APPROVED campaigns, summing the latest cumulative views of that creator's approved, live clips; sorted by numeric `campaignId` then `creator`. Contract tests on both sides share `cre/workflows/clippo-settlement/fixtures/snapshot-feed.json` (web: `src/lib/backend.integration.test.ts`; CRE: `cre/workflows/clippo-settlement/snapshot.test.ts`, run `npm test` in `cre/`).

### GET /api/campaigns/:id/views  `[public for APPROVED/CLOSED; owner/admin otherwise]`
Daily cumulative views history from `ViewSnapshot` (approved clips; per-clip values carried forward, never decreasing). Res 200: `{ "campaignId", "points": [ { "day": "YYYY-MM-DD", "views": 1800, "dailyViews": 800, "clips": 2 } ], "totalViews": 2800 }`.

### POST /api/snapshots/refresh  `[admin, or header x-cron-secret: $CRON_SECRET]`
Reads current views and stores one snapshot per approved clip for today (UTC), never decreasing. Res 200: `{ "day": "YYYY-MM-DD", "updated": number, "failed": string[], "needsHumanReview": string[], "flagged": string[], "deleted": string[], "restored": string[] }` (submission ids). The same job runs the anti-fraud checks:
- **Unusual view growth**: daily growth since the last snapshot above `max(ANOMALY_MIN_DELTA=5000, ANOMALY_MULTIPLIER=5 x median daily growth of the history)` (clips with <3 snapshots: above 10x the previous total) raises an OPEN `VIEW_ANOMALY` flag in the admin queue. While a flag is OPEN/CONFIRMED the clip is reported to the feed only up to its last snapshot before the flagged day.
- **Deleted/private clips** (YouTube: video missing or private): the submission becomes `clipStatus: "DELETED"`, an OPEN `CLIP_DELETED` flag is raised, the clip drops out of the feed, and the creator's unclaimed payouts in that campaign are frozen (`frozen: true`; claim refused with 409 `PAYOUT_FROZEN`). Already-claimed funds are untouched. A clip that becomes public again is restored automatically. Limitation: credits already on-chain and past the retention window can still be claimed directly on the contract; the 7-day retention window is what makes the freeze effective.

## Admin

### GET /api/admin/queue  `[admin]`
Res 200: `{ "pendingCampaigns": Campaign[] /* status FUNDED */, "flaggedSubmissions": SubmissionWithVerdict[] /* verdict NEEDS_HUMAN */, "appeals": SubmissionWithVerdict[] /* appealStatus PENDING */, "fraudFlags": FraudFlag[] /* status OPEN */ }`
where `SubmissionWithVerdict = Submission & { verdict, creator: {id, wallet}, campaign: {id, title, approver} }` and `FraudFlag = { id, kind: "VIEW_ANOMALY"|"CLIP_DELETED", campaignId, submissionId, day, details: { delta, baseline, threshold, ratio, cumulativeViews } | { videoId }, status: "OPEN"|"DISMISSED"|"CONFIRMED", createdAt, resolvedAt, resolvedBy }`.

### PATCH /api/admin/flags/:id  `[admin]`
Req: `{ "action": "DISMISS"|"CONFIRM" }`. Res 200: `{ "flag": FraudFlag }`. DISMISS = false alarm: a deleted clip is restored and its payouts unfrozen (unless another deleted clip by that creator in the campaign holds them) and a view-anomaly hold is released. CONFIRM = fraud: the clip stays excluded/frozen, the views stay held. 409 `BAD_STATE` if already resolved.

## Chain

### GET /api/chain/config  `[public]`
Res 200: `{ "chain": { "enabled", "chainId", "rpcUrl", "usdc", "escrow": "0x.."|null, "usdcDecimals": 6 }, "fees": { "campaignerBps", "creatorBps", "source": "chain"|"config", "retentionDays", "highValueThresholdUsdc" } }`. Fees are per side in bps (max 50), read from the escrow (cached 60 s) with env fallback `PLATFORM_CAMPAIGNER_FEE_BPS`/`PLATFORM_CREATOR_FEE_BPS` (default 25/25).

### POST /api/chain/sync  `[admin, or header x-cron-secret: $CRON_SECRET]`
Req (optional): `{ "maxBlocks"?: number }`. Indexes new escrow events since the stored cursor (from `ESCROW_DEPLOY_BLOCK`) idempotently (unique on tx hash + log index): `CampaignCreated` (only if it matches a DRAFT campaign: funder wallet, amount, mode, `metadataURI`) -> FUNDED; `CampaignApproved` -> APPROVED; `CampaignRejected` -> REJECTED; `CampaignClosed` -> CLOSED; `CreatorCredited` -> payout credit (+ `releaseAt`); `Claimed` -> payout claimed; `SplitFinalized` -> proposal FINALIZED; `HumanAttested` -> campaign attestation. Res 200: `{ "head", "lastBlock", "processed", "applied" }`. 503 `CHAIN_NOT_CONFIGURED` without `ESCROW_ADDRESS`. Run it on a schedule (cron) so credits/claims made outside the UI show up.

Client helpers for the UI: `src/lib/chain/client.ts` (`getChainConfig`, `connectWallet`, `signIn`, `previewFund`, `fundCampaign` = USDC approve + `createCampaign` + `POST /fund`, `previewClaim`, `claimPayout`, `approveCampaignOnchain`, `rejectCampaignOnchain`, `closeCampaignOnchain`, `approveSplit`). Typed bindings: `src/lib/chain/escrow-abi.ts` (generated from `contracts/abi/ClippoEscrow.json` by `npm run abi:sync`).

## Creator

### GET /api/creator/earnings  `[creator]`
Res 200:
```json
{ "campaigns": [ { "campaignId": "", "title": "", "payoutMode": "", "approvedClips": 2, "views": 1000, "estimatedEarnings": 12.5, "estimatedNet": 12.47, "creatorFeeBps": 25 } ],
  "payouts": [ Payout ],
  "totals": { "estimated": 12.5, "estimatedNet": 12.47, "claimable": 0, "claimed": 0, "frozen": 0 },
  "fees": { "creatorBps": 25, "source": "chain", "retentionDays": 7 } }
```
`estimatedEarnings` is gross (null for HUMAN_SPLIT: depends on the approved split); `estimatedNet` is after the creator-side platform fee (campaign snapshot bps, else current). PER_VIEW = views/1000 x rate, scaled down if the usable pool (pool minus campaigner fee) would be exceeded; POOL_SHARE = usable pool x share of views (or approved clips). Deleted clips earn nothing. `totals.claimable` is gross, unfrozen and unclaimed (PER_VIEW credits are claimable only after `payout.releaseAt`, the 7-day retention window); `frozen` is balance held back by anti-fraud review.

### GET /api/payouts/:id/claim  `[creator owner]`  (claim preview)
Res 200: `{ "payout": Payout, "preview": { "gross", "creatorFeeBps", "fee", "net" }, "claimable": boolean, "frozen": boolean, "frozenReason": string|null, "releaseAt": string|null, "retentionDays": number, "chain": PublicChainConfig, "onchain": { "functionName": "claim", "args": [onchainId] } | null }`. `gross` is the outstanding amount (`amount - claimedAmount`); the creator-side fee is deducted on-chain at claim time. `claimable` is false while frozen, inside the retention window, or already claimed.

### POST /api/payouts/:id/claim  `[creator owner]`
Records a claim. Req: `{ "txHash": string }` (required; verified against a `Claimed` event). Res 200: `{ "payout": Payout, "verified": true }`.
Chain mode: the receipt must be successful and contain a `Claimed` event from the escrow for this payout's campaign and the signed-in creator's wallet; amounts come from the event (the indexer applies it oldest payout first), otherwise 422 `CLAIM_NOT_VERIFIED`. 409 `PAYOUT_FROZEN` (deleted clip / fraud review), 409 `BAD_STATE` if already claimed.

---

## Integrations and configuration (see `.env.example`, run `npm run doctor`)

There are NO mock modes. Each integration is real; if its credentials are missing the endpoint answers **503 `NOT_CONFIGURED`** with `"... is not configured: set X"`. Test doubles exist only in `src/test/doubles.ts`, injected explicitly by tests through `setOverride` (`src/lib/config.ts`, refused when `NODE_ENV=production`).

| Integration | Env | Notes |
| --- | --- | --- |
| Postgres (Neon) | `DATABASE_URL` | Prisma `postgresql`; `npx prisma migrate deploy`. Tests run on a throwaway Postgres (PGlite) automatically. |
| World ID 4.0 | `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY` | see World ID |
| YouTube | `YOUTUBE_API_KEY` | Data API v3 for metadata/views/availability; captions read from the public caption track (null -> NEEDS_HUMAN) |
| X | `X_BEARER_TOKEN` | API v2; no audio -> human review |
| Instagram | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` | creator OAuth, see Instagram |
| AI | `ANTHROPIC_API_KEY` (`ANTHROPIC_MODEL`) | verifier, campaign writer, assistants |
| AI video | `GEMINI_API_KEY` (or `VIDEO_GEN_PROVIDER=http` + `VIDEO_GEN_URL`) | 503 NOT_CONFIGURED |
| Chain | `ESCROW_ADDRESS`, `ARC_RPC_URL`, `ARC_CHAIN_ID`, `USDC_ADDRESS` | fund/claim/approve/reject/close/split verify receipts and escrow state; no mirrored mode (503 without `ESCROW_ADDRESS`) |
| Profile / freeze signer | `UPDATER_PRIVATE_KEY`, `PROFILE_ADDRESS`, `REFERRAL_ADDRESS` | see Optional modules |
| On-ramp | `TRANSAK_API_KEY`, `TRANSAK_API_SECRET` | see On-ramp |
| Sign-in | wallet signature (SIWE) | dev bypass (`wallet` without signature, `x-wallet` header) only when `NODE_ENV != production` |

Dates/timestamps in responses are ISO 8601 UTC strings (`2026-10-27T12:00:00.000Z`), including deal offer `at` and proposal `createdAt/updatedAt/approvedAt`; view-snapshot days are `YYYY-MM-DD` (UTC).

Every API route is request-time dynamic (`route()` in `src/lib/http.ts` calls `connection()`), so `next build` does not prerender them.

Database: Prisma + Postgres. Migrations are in `prisma/migrations`. Local dev without Postgres: `npm run db:local` (PGlite on :5433, data in `.pgdata`).

---

## Optional modules (all OFF by default; disabled endpoints return 404 `FEATURE_DISABLED`)

Enable with env `FEATURE_STATUS_LADDER`, `FEATURE_REFERRAL`, `FEATURE_TOKENIZATION` set to `true`/`1` (helper: `src/lib/features.ts`). Hold until legal review: see `contracts/LEGAL_REVIEW.md`. Admin/cron endpoints accept an admin session or `x-cron-secret: $CRON_SECRET`.

### Status ladder (`FEATURE_STATUS_LADDER`)
Tiers VERIFIED < RISING < PARTNER < TOP from approved clips, approve rate, platform-verified views and fraud flags (any fraud flag caps at VERIFIED). Follower count is not used.
- `GET /api/status/ladder` Res: `{ tiers: [{ tier, requirements: { approvedClips, approveRate, verifiedViews } }] }`
- `GET /api/status/me` `[creator]` Res: `{ tier: Tier|null, metrics, nextTier, nextRequirements }`
- `POST /api/status/recompute` `[admin/cron]` Recomputes stored tiers. Res: `{ updated }`

### Referral (`FEATURE_REFERRAL`; env `REFERRAL_CUT_BPS`=500 (max 1000), `REFERRAL_CAP_USDC`=100, `REFERRAL_COOLDOWN_HOURS`=24)
- `POST /api/referral/links` `[creator]` Req `{ campaignId }` (APPROVED campaigns). Res 201 `{ link: { code, campaignId, ... } }`
- `GET /api/referral/links` `[creator]` Res `{ links }`
- `POST /api/referral/attribute` `[creator]` Req `{ code }`. Referee must be a verified unique human; 400 `SELF_REFERRAL`, 403 `HUMAN_REQUIRED` / `REFERRER_FROZEN`, 409 `ALREADY_REFERRED` (first attribution wins). Res 201 `{ attribution }`
- `GET /api/referral/summary` `[creator]` Res `{ links, referees, credited, remainingCap, frozen, config }`
- `POST /api/referral/accrue` `[admin/cron]` Req `{ refereeId, activity }` (USDC). Applies cut, cap, cooldown, freeze. Res `{ credit, reason: OK|FROZEN|COOLDOWN|CAP_REACHED|ZERO, creditId }`
- `POST /api/admin/referral/freeze` `[admin]` Req `{ userId, frozen, reason? }`. Res `{ state }`

### Creator on-chain profile (`FEATURE_TOKENIZATION`)
_Signer:_ `POST /api/creator/onchain-profile/sync` writes `ClippoCreatorProfile.updateProfile` with `UPDATER_PRIVATE_KEY` (must be registered via `setUpdater`) at `PROFILE_ADDRESS`; response `{ checked, changed, skipped }` (skipped = opted in off-chain but no on-chain `optIn()` yet). Missing key/address -> 503 `NOT_CONFIGURED`. _Fraud-freeze note:_ API-side payout/referrer freezes cannot stop a direct contract call; `POST /api/admin/referral/freeze` also mirrors the freeze on-chain (`ClippoReferral.setFrozen`, signer must be a guardian) when `REFERRAL_ADDRESS` + `UPDATER_PRIVATE_KEY` are set and reports `onchain: { mirrored, txHash? | reason }`; PER_VIEW credits rely on the retention window.
Non-transferable profile (`ClippoCreatorProfile`); no tradable token.
- `GET /api/creator/onchain-profile` `[creator]` Res `{ profile, preview: { tier, approvedClips, rejectedClips, totalViews, totalEarnedUsdc } }`
- `POST /api/creator/onchain-profile` `[creator]` Req `{ optIn: boolean }`. Res `{ profile }`
- `POST /api/creator/onchain-profile/sync` `[admin/cron]` Computes payloads for opted-in creators and records changes (the on-chain `updateProfile` write is a hook in `lib/modules/profile.ts#syncProfiles`, not wired to a signer here). Res `{ checked, changed }`. Tier is published only if the status ladder flag is also on.


---

<!-- BEGIN: CREATOR WORKSPACE + MARKETPLACE DATA (PRD 4.9 / 4.1) -->
# Creator workspace and marketplace data

All routes below follow the Conventions above. Source: `src/lib/workspace/*`. New models: `CreatorProfile`, `HireBrief`, `Shortlist`, `ShortlistItem`, `Hire`, `HireCreator` (no DB relations to older models; joined by id).

## Rank, tier and eligibility (definition)

For a creator, over their final verdicts across all campaigns: `approved` = APPROVE count, `rejected` = REJECT count (NEEDS_HUMAN is ignored until decided), `reliability = approved / (approved + rejected)` (0 if none).

| Tier | rank | needs |
| --- | --- | --- |
| `NEW` | 0 | default |
| `RISING` | 1 | approved >= 3 and reliability >= 0.6 |
| `PRO` | 2 | approved >= 10 and reliability >= 0.75 |
| `ELITE` | 3 | approved >= 25 and reliability >= 0.85 |

**Eligibility "higher-ranked creators only"** (`Campaign.eligibility = HIGHER_RANKED`): creator rank >= 1 (tier `RISING` or better). Enforced in `POST /api/submissions` (403 `NOT_ELIGIBLE`; this replaces the old "3+ approved clips" check, which now also requires reliability >= 0.6). **Verified badge**: `verifiedBadge: boolean` (= World ID `User.verified`) is returned on directory cards, leaderboard rows, trending `campaigner`, hire creators and the creator dashboard.

```ts
CreatorCard { creatorId, displayName, bio, niches: string[], rateCard: {label, platform?, price}[], verifiedBadge,
              tier, rank, approvedClips, reliability, platforms: Platform[] /* verified channels */, lowestRate }
BudgetRollup { approvedTotal, proposedTotal, rejectedTotal, approvedCount, proposedCount, rejectedCount, currency: "USDC", poolSize: number|null }
```

## Creator directory

### GET /api/creators  `[public]`
Vetted directory = listed profile + World ID verified + at least one verified channel. Query (all optional): `q` (name/bio/niche text), `tier` (minimum tier), `niche`, `platform`, `maxRate` (creator has a rate line <= this), `sort=tier|rate|clips` (default tier, then reliability), `limit` (<=200). Res: `{ creators: CreatorCard[] }`

### GET /api/creators/:id  `[public]`
Res: `{ creator: CreatorCard }`; 404 if unlisted/no profile.

### GET /api/creators/profile  `[creator]` / PUT /api/creators/profile  `[creator]`
PUT upserts: `{ displayName, bio?, niches?: string[], rateCard: [{ label, platform?, price }] (1..20, unique labels, price > 0 USDC), listed?: boolean }`. Rates are creator-set; campaigners can only pick a line and a quantity. Res: `{ profile }`.

## Briefs

### POST /api/briefs  `[campaigner]`
`{ title, story: Story, deliverables?: string[], platforms?: Platform[] (default ["YOUTUBE"]), deadline?: "YYYY-MM-DD", notes? }` -> 201 `{ brief }`. `GET /api/briefs` -> `{ briefs }`, `GET /api/briefs/:id` -> `{ brief }` (owner/admin).

## Shortlists

### POST /api/shortlists  `[campaigner]`
`{ title, creatorIds?: string[] }` (unlisted creators ignored) -> 201 `{ shortlist: {id,title,createdAt,shareToken}, creators: (CreatorCard & {note})[] }`.
`GET /api/shortlists` -> `{ shortlists }`; `GET /api/shortlists/:id` (owner/admin) -> same shape as create.
`POST /api/shortlists/:id/creators {creatorId, note?}` and `DELETE /api/shortlists/:id/creators/:creatorId` (owner) -> updated shortlist.

### GET /api/shortlists/shared/:token  `[public, read-only]`
Same shape, without `shareToken`. 404 for an unknown token.

## Hires (hire specific creators)

A **hire** = one brief + a set of creators, each with a rate-card line and an approval status `PROPOSED | APPROVED | REJECTED`. Hire `status`: `OPEN` (editable), then `FUNDING` once fund-all created the campaign (creators locked).

### POST /api/hires  `[campaigner]`
`{ title, briefId?, shortlistId? }`. With `shortlistId`, listed creators are added as `PROPOSED` at their lowest rate line, quantity 1. Res 201: `HireView` (below, with `hire.shareToken`).

### GET /api/hires  `[campaigner | creator | admin]`
Campaigner: own; creator: hires they are on; admin: all. Res: `{ hires: [{id,title,status,campaignId,createdAt}] }`.

### POST /api/hires/:id/creators  `[campaigner owner]`
`{ creatorId, rateLabel, quantity?: int (default 1) }`; `amount = rate.price x quantity` from the creator's own card (400 `BAD_RATE` if the label is not on it). Re-adding updates the line and resets to `PROPOSED`. 409 `BAD_STATE` once funded. Res 201: `HireView`.

### PATCH /api/hires/:id/creators/:creatorId  `[campaigner owner]`
`{ status: "PROPOSED"|"APPROVED"|"REJECTED" }` -> `HireView` with the **live budget total** (`budget.approvedTotal`). `DELETE` removes the creator. Both 409 once funded.

### GET /api/hires/:id  `[campaigner owner | admin | creator on the hire]`
Creators get the same view without `hire.shareToken`.
```ts
HireView { hire: { id, title, status, campaignId|null, campaignStatus|null, createdAt, shareToken? },
           brief: { id, title, story, deliverables, platforms, deadline, notes } | null,
           budget: BudgetRollup,
           creators: [{ creatorId, wallet, displayName|null, verifiedBadge, tier, rateLabel, quantity, amount, status,
                        tracking: { clips: [{submissionId, link, verdict, views}], approvedClips, rejectedClips, pendingReviewClips,
                                    views /* approved clips */, paid, claimed } }] }
```
Tracking is populated after funding (clips submitted to the hire's campaign).

### GET /api/hires/shared/:token  `[public, read-only]`
The same `HireView` (no token) for sharing between campaigner and creators. Share URL token = the campaigner's `hire.shareToken`.

### POST /api/hires/:id/fund  `[campaigner owner]`  ("fund all")
Optional body `{ onchainId?, txHash? }`. Requires a brief (409 `BRIEF_REQUIRED`) and at least one approved creator (409 `NO_APPROVED_CREATORS`); only once (409 `BAD_STATE`). Creates ONE campaign mapped to **HUMAN_SPLIT**:

| Campaign field | Value |
| --- | --- |
| `payoutMode` / `approver` | `HUMAN_SPLIT` / `CAMPAIGNER_ONLY` |
| `poolSize` | sum of APPROVED creators' `amount` (the preset amounts) |
| `story`, `platforms`, `title` | from the brief / hire |
| `eligibility` | `ANYONE_VERIFIED`, but submissions are restricted to the hire's APPROVED creators (403 `NOT_HIRED`) |
| `status` | `DRAFT`, or `FUNDED` if `onchainId` was supplied |

Res 201: `{ campaign, hire: {id,status,campaignId}, fundingIntent: { campaignId, currency: "USDC", poolSize, payoutMode, presetSplits: [{creatorWallet, amount}], next } }`.
Flow: escrow `poolSize` on-chain -> `POST /api/campaigns/:id/fund` (unless `onchainId` was given) -> admin approve -> approved creators submit clips -> split.

### GET /api/hires/:id/split-preset  `[campaigner owner | admin]`
Res: `{ campaignId, splits: [{creatorWallet, amount}], waiting: [{creatorWallet, amount, reason}] }`. `splits` = preset amounts of approved creators who now have an approved clip and no payout yet; send them as `splits` to `POST /api/campaigns/:id/split` together with a World ID proof (that endpoint enforces `BAD_RECIPIENT`/`EXCEEDS_POOL`).

### GET /api/campaigns/:id/eligibility  `[creator]`
Res: `{ eligible, reasons: ("NOT_VERIFIED"|"NOT_ELIGIBLE"|"NOT_HIRED")[], rule, requiredTier: "RISING"|null, creatorTier, restrictedToHiredCreators }`.

## Marketplace data

### GET /api/marketplace/trending  `[public]`
Query `limit` (default 20), `days` (window, default 7). APPROVED campaigns ranked by `trendScore = viewsGained(window) + 100 x approvedClips + 25 x submissionsInWindow` (ties: newest). Res: `{ windowDays, campaigns: [{ position, campaign: Campaign, campaigner: {id,wallet,verifiedBadge}, totalViews, viewsGained, approvedClips, submissions, trendScore }] }`.

### GET /api/leaderboard  `[public]`
Query `sort=views|earnings` (default views), `limit` (default 20). Over APPROVED/CLOSED campaigns. Res: `{ sort, creators: [{ position, creatorId, wallet, displayName|null, verifiedBadge, tier, views, approvedClips, campaigns, estimatedEarnings }] }`. `estimatedEarnings` uses the same formulas as `/api/creator/earnings` (before fees); for HUMAN_SPLIT it is the sum of allocated payouts.

### GET /api/dashboard/campaigner  `[campaigner]`
```ts
{ campaigns: [{ campaignId, title, status, payoutMode, budget /*poolSize*/, spend, allocated, remaining, views,
                clips: { approved, rejected, pendingReview, total }, costPer1kViews: number|null }],
  totals: { campaigns, budget, spend, views, approvedClips, rejectedClips, pendingReviewClips, costPer1kViews } }
```
`allocated` = payouts created. `spend` = `allocated` for HUMAN_SPLIT, else max(allocated, estimated accrued earnings). `views` = latest cumulative views of approved clips. `costPer1kViews = spend / views x 1000` (null when no views).

### GET /api/dashboard/creator  `[creator]`
```ts
{ verifiedBadge, rank: { approved, rejected, pending, reliability, tier, rank },
  totals: { views, clipsSubmitted, approvedClips, rejectedClips, pendingReviewClips, activeHires, estimated, claimable, claimed },
  campaigns: /* as /api/creator/earnings */, payouts: Payout[] }
```
New error codes: `BAD_RATE`(400), `BRIEF_REQUIRED`/`NO_APPROVED_CREATORS`(409), `NOT_HIRED`(403).
<!-- END: CREATOR WORKSPACE + MARKETPLACE DATA -->

<!-- BEGIN: PLATFORMS, SOURCE CONTENT, AI VIDEO, AGENT ASSISTANTS, APPEALS (PRD 4.1 / 4.2 / 4.7 / 4.8) -->
# Platforms, source content, AI video, assistants, appeals

Auth/roles as in Conventions.

## Platform adapters (YouTube, X, Instagram)
All platforms sit behind one registry (`src/lib/platforms`): `getPlatform(p)` -> `{ parseVideoId, normalizeHandle, isValidHandle, client() }`; `client()` has `checkChannelCode`, `fetchVideo`, `getViews`. Channel proof is always a code in the bio. **A clip or channel that cannot be read automatically is never skipped or auto-approved: it becomes a `NEEDS_HUMAN` verdict (flags `unreadable`, `platform_unavailable`) / a channel review.**

- `POST /api/channels` now takes `platform: "YOUTUBE" | "X" | "INSTAGRAM"` and validates the handle per platform (400 `BAD_HANDLE`).
- `POST /api/channels/:id/verify` `[creator]` checks the bio on the channel's platform. If the platform cannot be read (missing API access, rate limit) it answers **202** `{ channel, review: true, reason }` and notifies admins (`CHANNEL_REVIEW`); otherwise 200 `{channel}` or 422 `CODE_NOT_FOUND`.
- `POST /api/channels/:id/review` `[admin]` Req `{ approve: boolean, note? }` -> `{ channel }`; manually decides a channel awaiting review and notifies the creator.
- `POST /api/submissions`: the channel's platform must be listed in the campaign's `platforms` (400 `UNSUPPORTED_PLATFORM`); the link must parse for that platform (400 `BAD_LINK`). Unreadable X/Instagram clips -> 201 with `verdict.result = NEEDS_HUMAN`.
- Link shapes: X `https://x.com|twitter.com/<handle>/status/<id>`; Instagram `https://instagram.com/(reel|reels|p|tv)/<shortcode>/`.
- Data access: **X** needs `X_BEARER_TOKEN` and an API tier that allows reads; no spoken audio, so the transcript is `null` and clips go to human review (post text is the description); views from media `view_count` / `impression_count`. **Instagram** uses each creator's OWN OAuth token (Instagram API with Instagram Login; Business/Creator accounts): the post is read via `/me/media`, views via `/{media-id}/insights?metric=views`; there is no transcript (human review). A channel without a token, or with an expired one, raises "unavailable" -> human review.
- Instagram OAuth: `POST /api/channels/instagram/oauth/start` `[creator]` Req `{ channelId }` -> `{ url }` (redirect the creator there); Instagram redirects to `GET /api/channels/instagram/oauth/callback`, which verifies the signed state, requires the authorised username to equal the channel handle, stores the long-lived token encrypted (AES-GCM, never returned) and marks the channel verified, then redirects to `INSTAGRAM_POST_CONNECT_URL?instagram=connected|error`. `POST /api/channels/:id/verify` for Instagram answers 422 until connected.
- `POST /api/snapshots/refresh` additionally returns `needsHumanReview: string[]` (submission ids whose views could not be read automatically). They are not skipped silently.

## Source content (upload / playback / download / link)
Storage is an abstraction (`src/lib/storage`, `StorageProvider`); the default writes to `web/storage` (git-ignored, `STORAGE_DIR` to move it). Keys are server-generated; the client filename is only sanitised display text. Limits: mp4, webm, mov; content is sniffed (not just Content-Type); default max 500 MB (`SOURCE_MAX_BYTES`, bytes; the UI shows the same cap).

- `POST /api/uploads` `[campaigner]` multipart `file` (extra fields ignored). 201 `{ upload: { id, kind:"UPLOAD", name, size, mime, url, downloadUrl, aiGenerated:false, label:null, campaignId } }`. Errors: 400 `NO_FILE` / `EMPTY_FILE`, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_TYPE` / `TYPE_MISMATCH`.
- `GET /api/uploads/:id` -> `{ upload }`; `DELETE /api/uploads/:id` (owner/admin; not once the campaign is past DRAFT).
- `GET /api/uploads/:id/file` playback (inline, HTTP `Range` -> 206); `?download=1` -> attachment. Readable by the owner, admins, and any signed-in user once the campaign using it is APPROVED/CLOSED (404 otherwise). Sends `X-Content-Type-Options: nosniff`.
- `POST /api/campaigns/:id/source` `[campaigner owner, DRAFT only]` Req one of `{ uploadId }` | `{ url }` (link-a-video, http(s) only) | `{ jobId }` (AI video). Sets `contentSource` / `contentUrl` on the campaign. 200 `{ campaign, source, launchReady? }`.
- `GET /api/campaigns/:id/source` -> `{ contentSource, url, asset, job, launchReady }` (`job` / `launchReady` for managers; others only once the campaign is open).

## AI-generated source video
`VideoGenerator` interface (`src/lib/video`): `start(prompt) -> {providerJobId}`, `poll(id) -> {status, progress, output?}`. Providers (`VIDEO_GEN_PROVIDER`): **gemini** (default; Gemini Interactions API `POST /v1beta/interactions` with `background:true`, polled via `GET /v1beta/interactions/{id}`, base64 video decoded and stored; model `GEMINI_VIDEO_MODEL`, default `gemini-omni-1.1-flash` because the Veo 3.1 preview models were shut down on 2026-10-22), **http** (`VIDEO_GEN_URL` [+ `VIDEO_GEN_KEY`]: `POST {url}/jobs {prompt} -> {id}`, `GET {url}/jobs/{id} -> {status: queued|running|succeeded|failed, progress?, videoUrl?}`; `videoUrl` must be https), or register your own with `registerVideoGenerator(name, factory)`. No key -> 503 `NOT_CONFIGURED`.

Job shape: `{ id, status: "queued"|"rendering"|"ready"|"failed"|"approved", progress, prompt, videoUrl|null, label: "AI-GENERATED", aiGenerated: true, rightsConfirmed, approvalStatus: "PENDING"|"APPROVED"|"REJECTED", campaignId|null, error? }`.

- `POST /api/ai-video/jobs` `[campaigner]` Req `{ prompt (10..2000), rightsConfirmed: true, campaignId? }`. `rightsConfirmed` must be literally `true` (400 `RIGHTS_NOT_CONFIRMED`). 201 `{ job, generatorMode }`. `GET /api/ai-video/jobs` lists the caller's jobs.
- `GET /api/ai-video/jobs/:id` -> `{ job }`; polls the provider and, on success, stores the output as an `AI_GENERATED` source asset.
- `POST /api/ai-video/jobs/:id/approve` `[campaigner]` explicit approval of the rendered video (409 until rendered). `POST /api/ai-video/jobs/:id/reject` revokes approval.
- `GET /api/ai-video/jobs/:id/video` playback/download (`?download=1`, Range). Response header `X-Clippo-AI-Generated: true`.
- **Launch gate:** `POST /api/campaigns/:id/approve` on a campaign with `contentSource = AI_GENERATED` returns 409 `SOURCE_NOT_READY` / `RIGHTS_NOT_CONFIRMED` / `SOURCE_NOT_APPROVED` until the rights confirmation and the campaigner's approval exist (`assertSourceReadyForLaunch` in `src/lib/source.ts`). The chain path enforces it too: when the indexer sees an on-chain `CampaignApproved` for a campaign whose source is not ready, the campaign stays FUNDED, `adminReviewReason` is set and admins are notified (`LAUNCH_GATE`); `POST /api/campaigns/:id/approve` clears it once the source is ready.

## Agent assistants (advice only)
Model: Claude through `llm.ts` (`task: "assist"`). Every assistant computes a deterministic answer first and merges validated model fields over it, so a failed or malformed model answer still yields the same shape. Responses may include `aiMode: "real"`; a missing `ANTHROPIC_API_KEY` is a 503 `NOT_CONFIGURED`. **Guardrail: no assistant code path can release funds.** Agent modules are pure (no DB/chain), assistant routes never write payouts, a negotiated rate never moves money, and `src/lib/agents/guardrail.test.ts` fails if that changes.

Creator `[creator]`
- `POST /api/assistant/creator/explain` `{ campaignId }` -> `{ explanation: { plain, doList[], avoidList[], label } }`
- `POST /api/assistant/creator/check` `{ campaignId, link?, caption?, transcript?, script? }` -> `{ risks: [{ level: "block"|"warn"|"note", text, rule }], riskLevel: "LOW"|"MEDIUM"|"HIGH" }` (missing disclosure, prohibited claims, uncovered required points, attribution, platform, injection wording).
- `GET /api/assistant/creator/matches` -> `{ matches: [{ campaignId, title, fit 0..1, why, pays, platform }] }`

Admin `[admin]`
- `GET /api/assistant/admin/disputes` -> `{ disputes: [{ id (submission id), title, creator, verdictReason, appealNote, summary, recommend: "overturn"|"uphold"|"review", confidence, rank, rankWhy }] }` ranked for review (open appeals + NEEDS_HUMAN clips). Recommendation only; resolve with `POST /api/submissions/:id/verdict`.
- `GET /api/assistant/admin/growth` (`?all=true`) -> `{ anomalies: [{ id (submission id), campaign, creator, link, daily[], baseline, peakRatio, flagged, note, held }] }`.
- `POST /api/assistant/admin/growth/:id/hold` `{ held: boolean, reason? }` -> `{ held }`. A hold is a `VIEW_ANOMALY` fraud flag (the snapshot feed already honours it). It only withholds; lifting it dismisses open flags.

Campaigner writer (AEO/GEO)
- `POST /api/wizard/aeo` `[campaigner|admin]` `{ story }` -> `{ aeo: { description, faq: [{q,a}], jsonLd }, aiMode, usedLlm }`: entity-first, factual, self-contained copy plus FAQ and schema.org FAQPage JSON-LD for AI answer engines. `POST /api/wizard/suggest` now also returns `aeo` and guarantees `story.description` is quotable.

## Negotiator and deals (rate deals, PRD 4.8)
Rates are USDC per 1,000 views. Each side sets limits: the campaigner publishes a band `{minRate, maxRate}` and optionally `autoAcceptUpTo` (a standing instruction: creator offers at or below it are pre-accepted for the campaigner); the creator sets a private floor `minRate`. The negotiator computes counters **in code** inside the overlap (the model may only reword the note; numbers are verified unchanged). A deal is `ACCEPTED` only when **both** sides accept the same latest offer; accepting records `acceptedRate` and moves no money. States: `PROPOSED`, `COUNTERED`, `ACCEPTED`, `DECLINED`, `EXPIRED`.
Without published limits a band of +-50% around the campaign's `ratePer1k` is used (409 `NO_TERMS` if there is no rate either).

- `POST /api/campaigns/:id/deal/limits` `[campaigner owner]` `{ minRate, maxRate, autoAcceptUpTo? }` -> `{ terms }`
- `GET /api/campaigns/:id/deal` `[creator|campaigner]` (`?creatorId=` for the campaigner) -> `{ deal|null, band|null }`
- `POST /api/campaigns/:id/deal` `{ rate, note?, minRate? (creator floor), creatorId? (campaigner) }` -> 201 `{ deal }`. 400 `OUTSIDE_LIMITS`, 409 `NO_OVERLAP` / `BAD_STATE`.
- `POST /api/campaigns/:id/deal/accept` `{ creatorId? }`, `POST /api/campaigns/:id/deal/decline` `{ creatorId? }` -> `{ deal }`
- Deal view: `{ id, campaignId, status, creator, offers: [{ by: "creator"|"campaigner"|"negotiator", rate, note, at (ISO) }], acceptedBy: { creator, campaigner }, acceptedRate, limits: { minRate, maxRate, poolLeft, autoAcceptUpTo }, noOverlap }`. The viewer never sees the other side's private limit (`autoAcceptUpTo` is 0 for creators).

## Appeals (campaigner first, admin escalation) and notifications
`POST /api/submissions/:id/appeal` (creator, REJECT verdicts only) now also creates an `Appeal` and notifies the campaigner. Ownership: the campaigner reviews first (`dueAt` = `APPEAL_SLA_HOURS`, default 72); an admin may resolve once the appeal is escalated or overdue, earlier -> 409 `CAMPAIGNER_FIRST`.

States: `stage` `CAMPAIGNER` | `ADMIN`; `status` `OPEN` | `UPHELD` | `OVERTURNED`.
- Resolve with the existing `POST /api/submissions/:id/verdict` (campaigner on stage CAMPAIGNER, admin on stage ADMIN or overdue). Campaigner upholds -> `UPHELD` (creator may escalate); overturns -> `OVERTURNED` (verdict APPROVE); an admin decision is final. Wrong owner: 403 `FORBIDDEN`, 409 `ESCALATED`.
- `POST /api/appeals/:id/escalate` `[creator after an upheld rejection | campaigner while open]` -> stage ADMIN, `verdict.appealStatus` back to `PENDING`, admins and the other party notified.
- `GET /api/appeals` (`?status=`, admin `?all=true`) -> `{ appeals: [Appeal & { owner: "CAMPAIGNER"|"ADMIN"|"NONE", overdue }] }` (creator: own; campaigner: own campaigns; admin: escalated or overdue). `GET /api/appeals/:id` -> `{ appeal, verdict }`.
- `GET /api/notifications` (`?unread=true`) -> `{ notifications: [{ id, type, title, body, refType, refId, readAt, createdAt }], unread }`; `POST /api/notifications/read` `{ ids? | all: true }` -> `{ updated }`. Types: `APPEAL_OPENED`, `APPEAL_UPHELD`, `APPEAL_OVERTURNED`, `APPEAL_ESCALATED`, `CHANNEL_REVIEW`, `CHANNEL_VERIFIED`, `CHANNEL_REJECTED`, `DEAL_OFFER`, `DEAL_ACCEPT_PENDING`, `DEAL_ACCEPTED`, `DEAL_DECLINED`.

## Configuration added by this section
| Integration | Real when | Otherwise |
| --- | --- | --- |
| X | `X_BEARER_TOKEN` | 503 NOT_CONFIGURED |
| Instagram | `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET` + `INSTAGRAM_REDIRECT_URI` | 503 NOT_CONFIGURED (OAuth start) |
| AI video | `GEMINI_API_KEY` (or `VIDEO_GEN_PROVIDER=http` + `VIDEO_GEN_URL`) | 503 NOT_CONFIGURED |
| Assistants / AEO | `ANTHROPIC_API_KEY` | 503 NOT_CONFIGURED |
| Storage | `STORAGE_DIR` (default `web/storage`), `SOURCE_MAX_BYTES` | local disk |
<!-- END: PLATFORMS, SOURCE CONTENT, AI VIDEO, AGENT ASSISTANTS, APPEALS -->

## Backend integration pass: additions

### Dashboard: per-creator performance
`GET /api/dashboard/campaigner` -> each campaign item now has `creators: [ { creatorId, wallet, displayName, verifiedBadge, views, approvedClips, clipsSubmitted, cost, costBasis: "allocated"|"estimated", costPer1kViews, paid, claimed } ]`. `cost`: HUMAN_SPLIT = USDC allocated by the approved split; PER_VIEW / POOL_SHARE = estimate from the payout formula, never below what is already credited. `paid` = USDC credited to the creator (payout rows from on-chain events); `claimed` = the part already claimed on-chain; unclaimed = `paid - claimed`.

### Split proposals
- `GET /api/campaigns/:id/split` `[campaigner owner | admin]` -> `{ proposals: [ { id, campaignId, campaignTitle, onchainId, status: "PENDING"|"AWAITING_CHAIN", splitHash, splits, total, poolSize, twoParty, approvals: { campaigner, admin }, approvedAt: { campaigner, admin }, awaiting: ("campaigner"|"admin"|"chain")[], createdAt, updatedAt } ] }`.
- `GET /api/admin/split-proposals` `[admin]` -> the same list across all campaigns; `GET /api/admin/queue` also returns it as `splitProposals`.
- Note: with the chain mandatory, a completed split is `AWAITING_CHAIN` and payouts appear only after the indexer sees `SplitFinalized`/`CreatorCredited`.

### Deals (campaigner side)
`GET /api/campaigns/:id/deals` `[campaigner owner]` -> `{ band: { minRate, maxRate, autoAcceptUpTo }|null, deals: [ { creatorId, wallet, displayName, updatedAt, deal: Deal } ] }` (no creator picker needed). Counter-offer: `POST /api/campaigns/:id/deal { creatorId, rate, note }`; accept: `POST .../deal/accept { creatorId }`; limits: `POST .../deal/limits { minRate, maxRate, autoAcceptUpTo }`.

### Referral first visit
`GET|POST /api/referral/visit?code=CODE` `[public; FEATURE_REFERRAL]` validates the code, returns `{ valid, code, campaign: {id,title}|null }` and sets the 30-day HttpOnly cookie `clippo_ref`. After sign-in `POST /api/referral/attribute` works with an empty body (the code is read from the cookie, which is then cleared) or with `{ code }`. All existing rules still apply (verified unique human, first attribution wins, no self/circular referral).

### On-ramp (Transak)
- `POST /api/onramp/session` `[any signed-in]` Req `{ campaignId?, amount }` (USDC/USD amount) -> `{ url, orderId, environment: "staging"|"production" }`. `url` is a single-use (5 min) Transak widget URL created server-side (`/api/v2/auth/session`) for buying USDC to the signed-in wallet. 503 `NOT_CONFIGURED` without `TRANSAK_API_KEY`/`TRANSAK_API_SECRET`. Optional `TRANSAK_REFERRER_DOMAIN`, `TRANSAK_NETWORK`, `TRANSAK_REDIRECT_URL`, `TRANSAK_ENV` (staging default).
- `POST /api/onramp/webhook` (register this URL in the Transak dashboard): body `{ data: "<JWT>" }`; the HS256 signature (partner access token) and expiry are verified before anything is read (401 `BAD_SIGNATURE`), then `OnrampOrder` is updated by `partnerOrderId`.
- Testnet gas/USDC: `GET /api/chain/config` includes `faucetUrl` (`CIRCLE_FAUCET_URL`, default https://faucet.circle.com).
