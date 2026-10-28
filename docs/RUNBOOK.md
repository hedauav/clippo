# Runbook

Commands are from `contracts/README.md`, `cre/README.md` and `web/API.md`. Items marked UNVERIFIED were not executed when this was written. There are no mock modes: every integration is real and answers 503 `NOT_CONFIGURED` ("not configured: set X") until its credentials are set. Run `cd web && npm run doctor` at any time to see what is missing and to ping every service.

## 1. Deploy contracts to Arc testnet

Follow `contracts/README.md` (exact commands, env table, post-deploy checklist). In short:

```bash
cd contracts && forge build && forge test
export ADMIN_ADDRESS=0x... FORWARDER_ADDRESS=0x... UPDATER_ADDRESS=0x... EXPECTED_WORKFLOW_OWNER=0x...   # required (or INSECURE_SKIP_WORKFLOW_CHECK=true, simulation only)
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast --private-key $PRIVATE_KEY
cd ../web && npm run abi:sync
```

The script prints `ESCROW_ADDRESS`, `ESCROW_DEPLOY_BLOCK`, `REFERRAL_ADDRESS`, `PROFILE_ADDRESS`, `REPORT_RECEIVER_ADDRESS`: paste them into `web/.env.local`. The CRE forwarder address for Arc testnet must be taken from the Chainlink CRE docs (UNVERIFIED, not invented here). Arc gas is USDC: use the Circle faucet (https://faucet.circle.com).

## 2. Environment (complete list in `web/.env.example`)

1. **Postgres (Neon).** Create a project, copy the pooled connection string into `DATABASE_URL`, then `cd web && npx prisma migrate deploy`. No Postgres at hand for local dev: `npm run db:local` (PGlite on :5433) and use the URL printed in `.env.example`.
2. **Core:** `SESSION_SECRET`, `ADMIN_WALLETS`, `CRON_SECRET`.
3. **Chain:** `ESCROW_ADDRESS`, `ESCROW_DEPLOY_BLOCK`, optional `PROFILE_ADDRESS`, `REFERRAL_ADDRESS`, `UPDATER_PRIVATE_KEY` (testnet-only key registered with `setUpdater`).
4. **World ID 4.0:** Developer Portal -> create the app, enable World ID 4.0 (RP registration), keep `app_id`, `rp_id`, `signing_key`; create actions `clippo-creator-signup`, `clippo-approve-campaign`, `clippo-approve-split` (unlimited verifications for the two approval actions). Set `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY` (use `WORLD_ID_ENVIRONMENT=staging` with the simulator).
5. **AI (text: verifier, campaign writer, assistants):** either provider, switch with `LLM_PROVIDER=gemini|anthropic`.
   - **Free option, no credit card:** create a key at <https://aistudio.google.com/apikey> and set `GEMINI_API_KEY` (optionally `GEMINI_TEXT_MODEL`, default `gemini-3.5-flash-lite`). With only this key set, Gemini is selected automatically.
   - **Claude:** `ANTHROPIC_API_KEY` (`ANTHROPIC_MODEL`). If both keys are set and `LLM_PROVIDER` is empty, Anthropic is used. If neither is set the AI endpoints answer 503 `NOT_CONFIGURED` naming both options.
   - **Free-tier limits** ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [pricing](https://ai.google.dev/gemini-api/docs/pricing)): limits are per project (not per key), measured in requests/min, input tokens/min and requests/day; RPD resets at midnight Pacific. Google no longer prints per-model numbers in the docs: read yours at <https://aistudio.google.com/rate-limit>; preview models are stricter. Free-tier prompts and responses may be used by Google to improve its products (do not send secrets/PII; for end-user products in the EEA/UK/CH a paid key is required). The app therefore queues (`LLM_MAX_CONCURRENCY`, default 2), throttles (`LLM_RPM_LIMIT`, default 10/min on Gemini), retries 429/5xx with exponential backoff and Retry-After (`LLM_MAX_RETRIES`), caches identical requests (`LLM_CACHE_TTL_SECONDS`) and truncates long transcripts (`LLM_MAX_INPUT_CHARS`). When quota is exhausted the UI gets `429 AI_QUOTA_EXCEEDED` ("AI quota exceeded, try again"); the verifier never approves on a provider/quota error: the clip goes to NEEDS_HUMAN.
6. **Platforms:** `YOUTUBE_API_KEY` (Google Cloud, YouTube Data API v3); `X_BEARER_TOKEN` (X developer app; tier must allow reads); Instagram: Meta app with "Instagram API with Instagram Login", add `INSTAGRAM_REDIRECT_URI = https://<site>/api/channels/instagram/oauth/callback` and set `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (creators must be Business/Creator accounts; Meta app review is required for non-tester accounts).
7. **AI video:** `GEMINI_API_KEY` (Google AI Studio); model `GEMINI_VIDEO_MODEL` (default `gemini-omni-1.1-flash`). Per the [pricing page](https://ai.google.dev/gemini-api/docs/pricing), `gemini-omni-1.1-flash` is "Not available" on the Free tier (paid tier only, about $0.10 per second of 720p video): the free key works for text, but video generation needs billing enabled on the same project (prepay at least $5 in AI Studio). Without billing, video jobs fail with the provider error; everything else keeps working.
8. **On-ramp:** Transak partner dashboard (staging) -> `TRANSAK_API_KEY`, `TRANSAK_API_SECRET`, whitelist the server IP, register `https://<site>/api/onramp/webhook`.
9. **Storage:** `STORAGE_DIR` on a persistent disk (local disk is ephemeral on serverless hosts); upload cap `SOURCE_MAX_BYTES` (default 500 MB).
10. `cre/.env`: `CRE_ETH_PRIVATE_KEY` (testnet only). `cre/workflows/clippo-settlement/config.staging.json`: `backendUrl`, `evm.receiverAddress`, `chainSelectorName` `arc-testnet`. `cre/project.yaml`: Arc RPC URL and workflow owner.

## 3. Run CRE simulate

```bash
cd cre && npm install && npm run typecheck && npm test   # npm test = snapshot contract test
cre login
npm run simulate                # dry run
npm run simulate:broadcast      # writes the report on-chain
```

Prerequisites: `escrow.setReportAdapter(receiver)` (done by the deploy script) and the receiver's forwarder. `/api/snapshots/latest` already emits the numeric on-chain `campaignId` (campaigns without an `onchainId` are skipped), and `cre/.../snapshot.ts` normalises exactly that; both are covered by the shared fixture `cre/workflows/clippo-settlement/fixtures/snapshot-feed.json`. The `cre` CLI has not been run in this repo's build environment (UNVERIFIED).

## 4. Run the app

```bash
cd web && npm install && npx prisma migrate deploy && npm run doctor && npm run dev
```

Tests: `npm test` (spins up its own throwaway Postgres; no setup). Production build: `npm run build`.

## 5. Seed / first run

No seed script exists. Sign in with a real wallet (SIWE); in development only, `x-wallet` / unsigned sign-in works for quick checks.

1. Admin signs in (`ADMIN_WALLETS`). Campaigner and creators sign in.
2. Creator: World ID check through IDKit (`POST /api/worldid/rp-signature`, then `POST /api/worldid/verify` with the IDKit result).
3. Creator: `POST /api/channels`, put the code in the bio, `POST /api/channels/:id/verify` (Instagram: `POST /api/channels/instagram/oauth/start`).
4. Campaigner: wizard, `POST /api/campaigns`, fund on-chain (buy USDC with `POST /api/onramp/session`, or the Circle faucet), then `POST /api/campaigns/:id/fund {txHash}`.
5. Admin: on-chain `approveCampaign` (+ `/attest` for high-value), `POST /api/campaigns/:id/approve`.
6. Creator submits real clip links; cron/admin `POST /api/snapshots/refresh`; check `GET /api/snapshots/latest`.

## 6. What changed from the old mocks

| Old mock | Now |
| --- | --- |
| `ALLOW_MOCK_CHAIN`, mirrored funding/claims | removed: chain verification is mandatory, 503 without `ESCROW_ADDRESS` |
| mock World ID verifier | removed: Developer Portal v4 verify; 503 without `WORLD_ID_*` |
| mock YouTube/X/Instagram | removed: Data API v3, X API v2, Instagram creator OAuth |
| mock LLM / templated writer | removed: Claude or Gemini (`LLM_PROVIDER`); 503 without `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` |
| mock video generator | removed: Gemini Interactions API (polled, stored) or HTTP provider |
| SQLite | Postgres (Neon) + migrations |
| UI widgets | `WorldCheck` (IDKit 4 / `rp-signature`) and wallet escrow calls live in `web/src/components` (UI agent) |

## 7. Not verified here

Real credentials were not available, so the real-service code paths were exercised only against stubbed HTTP in tests: World ID v4 verify, YouTube captions scraping, X, Instagram OAuth/insights, Gemini Omni video and Gemini text generation via the Interactions API (request/response shapes taken from the docs; no live key was available), Transak session/webhook, on-chain signer writes. `npm run doctor` pings the ones that can be pinged with a key.
