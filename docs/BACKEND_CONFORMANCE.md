# Backend conformance: Unified PRD vs web/src/lib, web/src/app/api, web/prisma

Audit of "Clippo — Unified PRD.md" (sections 3, 4.1-4.11, 5-8) against the backend, 2026-10-28.
Status: DONE / PARTIAL / MISSING. **Before** = state when the audit started, **After** = after the fixes in this pass.
Test keys: `PC` src/lib/prd-conformance.test.ts (new), `BI` src/lib/backend.integration.test.ts, `PA` src/lib/platform-agents.e2e.test.ts,
`TI` src/lib/chain/trust.integration.test.ts, `WS` src/lib/workspace/workspace.test.ts, `VT` src/lib/ai/verifier.test.ts,
`PL` src/lib/platforms/platforms.test.ts, `CT` src/lib/chain/chain.test.ts, `AP` src/lib/agentpass/agentpass.integration.test.ts,
`AG` src/lib/agents/*.test.ts, `MO` src/lib/modules/modules.test.ts, `SI` src/lib/worldid/signup.integration.test.ts,
`ST` src/lib/storage/storage.test.ts, `VD` src/lib/video/video.test.ts, `AN` src/lib/antifraud/anomaly.test.ts,
`E2E` web/scripts/e2e-api.mjs (HTTP, real dev server). Route paths are under web/src/app/api.

## Traceability matrix

| # | PRD requirement | Implemented in | Test | Before | After |
|---|---|---|---|---|---|
| 1 | 2 Roles: campaigner, creator, admin; AI agent never moves money alone | `Role` enum (schema); `lib/auth.ts` `requireUser(roles)`; `ADMIN_WALLETS` | PC (role enum), E2E (403s), AG guardrail | DONE | DONE |
| 2 | 3.1 Wizard answers + generated story | `wizard/suggest`, `lib/ai/campaign-writer.ts` | PC wizard, E2E, AG | DONE | DONE |
| 3 | 3.2 Fund the pool in USDC | `campaigns/[id]/fund` (GET preview, POST verifies the createCampaign receipt), `lib/chain/indexer.ts` | PC, TI, E2E (NOT_CONFIGURED asserted) | DONE | DONE |
| 4 | 3.3 / 4.6 Admin approves after create+fund, before creators join | `campaigns/[id]/approve`; submissions require `status = APPROVED` | PC (FUNDED campaign refuses submissions; non-admin 403), TI | DONE | DONE |
| 5 | 3.3 Admin reject returns the pool in full (pool + campaigner fee) | `campaigns/[id]/reject` (needs on-chain `Rejected`; refund `includesFee`) | PC (CHAIN_STATE_MISMATCH then 200 with refund), TI | DONE | DONE |
| 6 | 3.4 Verified creators browse, join, post, submit links | `campaigns` GET (APPROVED only), `campaigns/[id]/eligibility`, `submissions` POST | PC, PA, WS | DONE | DONE |
| 7 | 3.5 AI checks each link: approve / reject / human | `submissions` POST -> `lib/ai/verifier.ts` | VT, PA | DONE | DONE |
| 8 | 3.6 Views recorded daily or manual approval by payout rule | `lib/snapshots.ts` `refreshSnapshots`, `snapshots/*`; `campaigns/[id]/split` | BI, TI | DONE | DONE |
| 9 | 3.7 Creators claim | `payouts/[id]/claim` (verifies the `Claimed` receipt) | TI | DONE | DONE |
| 10 | 3.8 / 4.1 Close, unspent returns to campaigner | `campaigns/[id]/close` (needs on-chain `Closed`) | TI | DONE | DONE |
| 11 | 4.3 Q1 "What are you promoting": free text -> full story | `wizard/suggest` (`writeCampaign`), `wizard/aeo` | AG (AEO), PC, E2E | DONE | DONE |
| 12 | 4.3 Q2 Content: upload / link / AI video (each option) | `uploads`, `campaigns/[id]/source` (uploadId / url / jobId), `ai-video/jobs*` | PC (all 3 persisted), PA, E2E | DONE | DONE |
| 13 | 4.3 Q3 Platforms YouTube / X / Instagram (one or more) | `campaigns` POST (`platforms` min 1), submissions enforce platform | PC (single and multi sets), PL | DONE | DONE |
| 14 | 4.3 Q4 Payout: per view / approve split / share pool | `campaigns` POST `payoutMode` + required-field rules | PC (valid + each missing-field 400) | DONE | DONE |
| 15 | 4.3 Q5 Pool share basis: views / approved clips | `poolShareBasis` (required for POOL_SHARE) | PC | DONE | DONE |
| 16 | 4.3 Q6 Approver: only me / me and an admin | `approver` (required for HUMAN_SPLIT); `split` 2-party | PC, TI (two-party and single) | DONE | DONE |
| 17 | 4.3 Q7 Pool size and view target: AI suggestions, editable | `suggestPools` (3 tiers; rate only for PER_VIEW); `campaigns` POST accepts edits | PC | DONE | DONE |
| 18 | 4.3 Q8 Who can join: anyone verified / higher-ranked only | `eligibility`; `lib/workspace/eligibility.ts` (tier >= RISING) | WS, PC | DONE | DONE |
| 19 | 4.4 Per verified view (rate per 1,000, cap by pool, new views only) | escrow `reportViews` fed by `snapshots/latest` (cumulative); `earnings.ts` estimate | BI, WS (marketplace math), contracts tests | DONE | DONE |
| 20 | 4.4 Human-verified split: AI pre-scores, human(s) approve, fresh human check | `campaigns/[id]/split` (+propose, audit), `lib/agentpass/*`, `lib/worldid/fresh.ts` | TI, AP | DONE | DONE |
| 21 | 4.4 Pool share: whole pool divided by share of verified views OR approved clips | **new** `campaigns/[id]/pool-share` + `lib/poolshare.ts` produce the escrow `setWeights` arguments per the chosen basis; escrow pays pro rata at close | PC (both bases, rejected clips excluded, 403/409) | MISSING (no code computed the weights; only an earnings estimate existed) | DONE |
| 22 | 4.4 All modes: creators claim, every settlement step visible to both sides | `payouts`, `creator/earnings`, `campaigns/[id]/split` GET, `dashboard/*` | WS, BI | DONE | DONE |
| 23 | 4.5 Fee in 0.1 to 0.5 range (percent, to confirm) | `lib/chain/fees.ts`: **now clamps to 10..50 bps**, default 25 bps; on-chain values are read from the escrow | PC (boundaries 0/10/50/51), E2E | PARTIAL (env accepted 0..50 bps) | DONE |
| 24 | 4.5 Both sides pay: campaigner at funding, creator at claiming | `fundPreview`, `claimPreview`, `creatorFeeBps` snapshots | CT, PC, E2E | DONE | DONE |
| 25 | 4.6 Admin queue: campaigns, flagged clips, appeals, unusual view patterns | `admin/queue`, `admin/flags/[id]` | PC (all four lists), E2E | DONE | DONE |
| 26 | 4.6 Admin assistant summarises disputes, ranks queue | `assistant/admin/disputes`, `assistant/admin/growth*`, `lib/agents/admin.ts` | AG, PA | DONE | DONE |
| 27 | 4.7 Platform order YouTube, then X, then Instagram; each has ownership proof + content + views | `lib/platforms/{index,x,instagram}.ts`, `lib/youtube` | PL, PA | DONE | DONE |
| 28 | 4.7 / 8 Unreadable clip goes to human review, never skipped or auto-approved | `submissions` POST (`readable:false` -> NEEDS_HUMAN flags `unreadable`); verifier null transcript; `refreshSnapshots` lists `needsHumanReview`; channel proof 202 + admin `channels/[id]/review` | PL ("unreadable clips go to human review"), PA | DONE | DONE |
| 29 | 4.7 Platform data-access rules to confirm | Real X / Instagram adapters answer 503 NOT_CONFIGURED without credentials | PL (no mock fallbacks) | DONE (credentials needed) | DONE (credentials needed) |
| 30 | 4.8 Campaigner agent: story, AEO description, suggests rate/pool/target | `campaign-writer.ts`, `wizard/aeo` | AG | DONE | DONE |
| 31 | 4.8 AI-generated source video, labelled AI-generated, approved before launch, rights confirmed | `ai-video/jobs*`, `lib/video`, `lib/source.ts` `assertSourceReadyForLaunch` (also enforced on the on-chain approve path) | VD, PA, TI | DONE | DONE |
| 32 | 4.8 Creator agent: explain brief, warn before submit, suggest campaigns | `assistant/creator/{explain,check,matches}` | AG, PA | DONE | DONE |
| 33 | 4.8 Admin agent: flagged items, disputes, suspicious growth | `assistant/admin/*` | AG | DONE | DONE |
| 34 | 4.8 Negotiator proposes within both sides' limits; both accept | `campaigns/[id]/deal*`, `lib/agents/negotiator.ts`, `lib/deals.ts` | AG, PA | DONE | DONE |
| 35 | 4.8 Guardrail: agents never release payouts; high-value needs fresh unique-human | static guardrail tests; `campaigns/[id]/attest` + `approve` (428 `HUMAN_CONFIRMATION_REQUIRED`); every split approval consumes a fresh proof | AG guardrail, AP guardrail, TI | DONE | DONE |
| 36 | 4.9 Vetted tiered directory, creator-set rates | `creators`, `creators/profile`, `lib/workspace/hires.ts` `listCreators` | WS, E2E (unverified hidden) | DONE | DONE |
| 37 | 4.9 Shareable shortlists, structured briefs, approvals with live budget | `shortlists*`, `briefs*`, `hires*` | WS, E2E | DONE | DONE |
| 38 | 4.9 One funding action covering every creator | `hires/[id]/fund` (one HUMAN_SPLIT campaign, preset amounts) | WS | DONE | DONE |
| 39 | 4.9 Per-creator tracking, shared campaign view | `hires/[id]`, `hires/shared/[token]`, `campaigns/[id]/views`, `dashboard/*` | WS, BI | DONE | DONE |
| 40 | 4.10 Optional modules off by default (tokenization, referral, status ladder) | `lib/features.ts` `requireFeature` on every module route | MO, PC (4 routes), E2E (6 routes) | DONE | DONE |
| 41 | 4.11 Out of scope absent: Radar Room, Jobs, AI agents as creators, bank cash-out, citation dashboard | no such routes; `Role` has no agent; session rejects role AGENT | PC (route-tree scan + enum + 400), E2E (404s) | DONE (untested) | DONE |
| 42 | 4.2.1 Channel belongs to the submitting creator | `submissions` POST `channelOwned`; verifier `channel_mismatch` REJECT | VT, PA | DONE | DONE |
| 43 | 4.2.2 Read transcript and metadata | `lib/platforms/*`, `lib/youtube`; stored on `Submission` | PL, PA | DONE | DONE |
| 44 | 4.2.3 Compare with story: topic, required points | LLM verifier prompt (story outside delimiters) | VT | DONE | DONE |
| 45 | 4.2.3 Prohibited claims and required disclosure label checked | **new** `checkStoryRules` in `lib/ai/verifier.ts`: deterministic backstop; an LLM APPROVE with a missing label or a prohibited claim becomes NEEDS_HUMAN (flags `disclosure_missing`, `prohibited_claim_suspected`); never approves | PC (6 rule cases, 4 verdict cases), VT | PARTIAL (LLM-only) | DONE |
| 46 | 4.2.3 Attribution to the source | LLM prompt only (free-text rule cannot be matched deterministically) | VT (prompt) | PARTIAL | PARTIAL (by design, see decisions) |
| 47 | 4.2.4 Duplicate and near-duplicate | `lib/ai/duplicates.ts` (hash + 3-shingle Jaccard >= 0.8); same video link refused | VT, PA | DONE | DONE |
| 48 | 4.2.5 Verdict with confidence and written reason | `Verdict` model; threshold `VERIFIER_CONFIDENCE_THRESHOLD` (0.75) | VT | DONE | DONE |
| 49 | 4.2 Borderline/low confidence -> campaigner (and admin if chosen) | NEEDS_HUMAN visible to campaigner via `campaigns/[id]/submissions`, resolved by `submissions/[id]/verdict`; all NEEDS_HUMAN also in `admin/queue` (with `campaign.approver`) | PA, PC (queue) | PARTIAL | PARTIAL (see decisions: admin sees all, not only when chosen) |
| 50 | 4.2 Every verdict + reason stored, visible to the creator, who can appeal | `submissions` GET, `submissions/[id]/appeal`, `appeals*` (campaigner first, SLA, admin escalation) | `appeals.test.ts`, PA | DONE | DONE |
| 51 | 4.2 Clip text is data only (prompt injection) | delimiters + nonce, sanitising, `detectInjection` downgrade | VT (injection suite) | DONE | DONE |
| 52 | 4.2 Only approved clips earn | snapshots / earnings / pool-share filter `verdict = APPROVE`, `clipStatus = LIVE` | BI, PC | DONE | DONE |
| 53 | 8 Fake/inflated views flagged | `antifraud/anomaly.ts`, `FraudFlag`, feed hold to the day before the flag | AN, TI | DONE | DONE |
| 54 | 8 Retention window before final payout | `releaseAt` tranches (escrow `retentionPeriod`, default 7 d), claim preview `claimable` | TI | DONE | DONE |
| 55 | 8 Clip deleted after payout: unpaid balance rules | `antifraud/availability.ts` + `flags.ts`: freeze unclaimed balance, refuse claim (409 `PAYOUT_FROZEN`), restore on dismiss | TI | DONE | DONE |
| 56 | 4.1 Escrowed pools, many campaigns, one deployment | `contracts/src/ClippoEscrow.sol`; `chain/*` | CT, TI (contracts: forge tests) | DONE | DONE |
| 57 | 4.1 Cumulative views daily, only new views paid, pool cap | `ViewSnapshot` (monotonic per day), `snapshots/latest` + frozen `snapshots/daily`; credit logic in the escrow | BI (CRE contract fixture) | DONE | DONE |
| 58 | 4.1 Pull payments | claim flow above | TI | DONE | DONE |
| 59 | 4.1 One person, one account (unique human) | `worldid/verify` + unique nullifier, `assertVerifiedHuman` on channel/deal/submission/claim | SI | DONE | DONE |
| 60 | 4.1 Channel ownership proof (bio code), several channels | `channels` POST/GET (many per user, unique per platform+handle), `channels/[id]/verify`, Instagram OAuth | PC (3 platforms + failing code + CHANNEL_TAKEN), PA | DONE | DONE |
| 61 | 4.1 Marketplace trending + creator leaderboard (views and estimated earnings) | `marketplace/trending`, `leaderboard?sort=views|earnings` | BI, WS, E2E | DONE | DONE |
| 62 | 4.1 Separate onboarding, account page, creator socials page | role fixed at sign-in (`auth/session`), `auth/me`, `channels` GET = the creator's linked socials with verification state | E2E | DONE | DONE |
| 63 | 4.1 Campaign detail with performance and payout progress, campaigner dashboard | `campaigns/[id]` (`performance`), `campaigns/[id]/views`, `dashboard/campaigner`, `dashboard/creator` | BI | DONE | DONE |
| 64 | 4.1 Source content upload, playback (Range), download | `uploads`, `uploads/[id]/file` (`?download=1`), `lib/source.ts`, `lib/storage/*` | ST, PA, E2E (206 + attachment + 415) | DONE | DONE |
| 65 | 4.1 Verified badge | `verifiedBadge` in leaderboard / trending / directory / campaign `campaigner.verified` | WS | DONE | DONE |
| 66 | 5 USDC only, all on-chain, no cash-out | no off-ramp routes; on-chain claim | PC (route scan) | DONE | DONE |
| 67 | 5 Funding via on-ramp | `onramp/session`, `onramp/webhook` (Transak JWT) | BI | DONE | DONE |
| 68 | 5 Chain endpoints fail loudly without an escrow (NOT_CONFIGURED, no mock) | `lib/chain/guards.ts` `chainMode()`; **fixed** `POST /api/chain/sync` returned a bare 500 without an escrow, now 503 `CHAIN_NOT_CONFIGURED` | PC, E2E | PARTIAL (500) | DONE |
| 69 | 6.1 CRE: one frozen snapshot per day, numeric campaign ids | `snapshots/latest` (numeric on-chain ids), `snapshots/daily` (UTC-day frozen + hash/ETag) | BI (shared CRE fixture), E2E | DONE | DONE |
| 70 | 6.2 IDKit: backend validates, then marks verified | `worldid/verify`, `worldid/rp-signature`, `lib/worldid/*` | SI, BI | DONE (credentials needed) | DONE (credentials needed) |
| 71 | 6.2 Agent Pass: fresh World ID check before release; cancelled / expired / repeated leave action undone | `split`, `attest`, `lib/agentpass/*`, `lib/worldid/fresh.ts`, audit log | AP, TI | DONE | DONE |
| 72 | 8 AI-generated video rights | `rightsConfirmed` required on job creation + launch gate | PA, VD | DONE | DONE |

## Counts

| | DONE | PARTIAL | MISSING | Total |
|---|---|---|---|---|
| Before | 66 | 5 | 1 | 72 |
| After | 70 | 2 | 0 | 72 |

Rows whose Before differs: #21 MISSING -> DONE, #23 PARTIAL -> DONE, #45 PARTIAL -> DONE, #68 PARTIAL -> DONE.
Untested-before rows now covered by PC: #4, #5, #12-#18, #25, #40, #41, #60, #66.

## Fixes made in this pass

1. **Pool share weights (new).** `GET /api/campaigns/:id/pool-share` + `lib/poolshare.ts`: weights per creator wallet from verified views or approved clips (campaign `poolShareBasis`), live approved clips only, anomaly holds respected, plus the exact `setWeights(id, creators[], weights[])` arguments. Owner/admin only, APPROVED POOL_SHARE campaigns only. Moves no money.
2. **Disclosure label / prohibited claims backstop** in `lib/ai/verifier.ts` (`checkStoryRules`): text can only downgrade an approval to human review.
3. **Fee range**: `lib/chain/fees.ts` env fees clamp to 10..50 bps (0.1-0.5%), fallback 25 bps.
4. **`POST /api/chain/sync` 500 -> 503**: `liveDeps()` in `lib/chain/indexer.ts` is a default argument evaluated before the caller's own check; it now throws 503 `CHAIN_NOT_CONFIGURED` (also protects `processReceipt`).
5. **Test-suite regression from a concurrent edit**: `assertOnchainState` (lib/chain/guards.ts) had gained an unconditional `syncChain()` that hit the live Arc RPC (429) in three existing tests. It is now skipped when the `escrowReader` test double is installed; production behaviour is unchanged.
6. Tests: `src/lib/prd-conformance.test.ts` (13 cases) and the HTTP script `web/scripts/e2e-api.mjs` (32 steps).

## HTTP end-to-end run (web/scripts/e2e-api.mjs, 32/32 PASS)

Run against `next dev` on :3231 (own `NEXT_DIST_DIR`) with an isolated PGlite DB on :5461, because the shared 3217 server / :5433 DB was answering `DATABASE_UNAVAILABLE` / 500 (its single connection was wedged by another process; I did not touch it). Steps: SIWE sign-in x2 with random keys (replay and forged signature refused) · role gates · admin via dev bypass · wizard suggest · create per payout mode + 400s · draft privacy · fund preview (fees in range) · fund POST = 503 NOT_CONFIGURED · admin approve = 503 NOT_CONFIGURED · admin reject of a draft · admin queue · pool-share gating · World ID verify / rp-signature = 503 NOT_CONFIGURED · channel proof = 403 NOT_VERIFIED · submission gate · appeal/verdict gates · claim 404 · upload + Range 206 + download + spoof 415 · source link validation · AI video 400 / 503 NOT_CONFIGURED · creator profile (unverified hidden from directory) · shortlist/brief/hire · dashboards, leaderboard, trending · snapshots latest (numeric ids) and daily (frozen) · chain config / sync = 503 · on-ramp 503 · optional modules 404 FEATURE_DISABLED (6 routes) · out-of-scope 404s · assistant gating.
Not reachable over HTTP without credentials (covered by vitest with doubles instead): verified-creator channel code flow, submission -> verdict, appeal, claim, split approval, fund/approve/reject happy paths.

## Remaining gaps and reasons

| Gap | Reason |
|---|---|
| Real World ID (IDKit / Agent Pass), YouTube/X/Instagram data, escrow + RPC, Transak, LLM and video providers | No credentials exist yet; every real adapter answers 503 NOT_CONFIGURED, by design. Only the test doubles run the happy paths. |
| Attribution check is LLM-only (#46) | The rule is free text; a string match would be wrong more often than right. |
| Borderline clips: admin sees every NEEDS_HUMAN, not only when the campaigner chose "me and an admin" (#49) | Admin also owns disputes and unreadable clips (4.6/4.7), so filtering would hide work; `campaign.approver` is returned so a UI can filter. |
| Pool share weights are sent by a human wallet (`setWeights`); no server wallet does it | Deliberate: agents/server never release money. |
| Shared 3217 dev server / :5433 DB | Wedged (DB connection) at audit time; not mine to restart. |

## PRD ambiguity decisions

- **Fee unit**: 0.1 to 0.5 read as percent per side (10..50 bps); default 25 bps. Config outside the range falls back to 25 bps rather than silently accepting 0.
- **Creator "join"**: there is no separate join action; submitting a link to an APPROVED campaign (with eligibility met) is joining. `campaigns/[id]/eligibility` tells the creator why they cannot.
- **Creator socials page**: backed by `GET /api/channels` (all linked channels with verification state), not a separate model.
- **Disclosure matching**: a generic label (`#ad`, `sponsored`, `advertisement`, `paid partnership`) is satisfied by any of those words as whole words in transcript/title/description; a custom label must appear as a phrase. On-screen-only labels cannot be seen, so a missing text label goes to human review rather than REJECT.
- **Admin reject after funding (9.4)**: allowed, full refund including the campaigner fee, as the escrow's `rejectCampaign` does.
