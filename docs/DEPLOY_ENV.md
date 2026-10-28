# Vercel environment variables (public TEST deployment)

Project root directory on Vercel: `web`. Scopes: **P** = Production, **V** = Preview, **D** = Development (`vercel env pull`). Check readiness any time with `GET /api/health` (booleans only) and `node scripts/smoke-deploy.mjs <url>`.

`NEXT_PUBLIC_*` values are inlined into the browser bundle **at build time**: changing one needs a redeploy. Never put a secret in a `NEXT_PUBLIC_*` variable.

## DO NOT SET ON VERCEL (ever)

| Variable | Why |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Contract deploy key (Foundry `contracts/`). Only used from a developer machine. |
| `ADMIN_PRIVATE_KEY` | Admin/owner key of the contracts (pause, setUpdater, fee changes). Server code never signs with it. |
| `CRE_ETH_PRIVATE_KEY` | Chainlink CRE workflow signer. Used by `cre/` locally / CRE network only. |
| `AGENT_PASS_PRIVATE_KEY` | Real-mode Agent Pass wallet. The test deploy runs `AGENT_PASS_DEMO=1` (a derived, clearly-labelled demo wallet, no key). If real mode is ever needed on Vercel, use a fresh, empty, testnet-only key, treat it as leaked-on-day-one, and record the decision here. |
| `UPDATER_PRIVATE_KEY` | Only when an optional module is on (`FEATURE_TOKENIZATION` / `FEATURE_REFERRAL`; default off). It is a hot server signer: fresh testnet-only key, minimal gas, registered via `setUpdater`. Leave unset otherwise. |
| `CLIPPO_E2E_DOUBLES`, `E2E_CONTROL_FILE` | Test-double switch. The server refuses to boot with it under `NODE_ENV=production` or on Vercel. |
| `NEXT_PUBLIC_DEMO` | Ships sample data in the UI. Leave unset. |
| `ALLOW_WALLET_HEADER`, any dev wallet bypass | Ignored in production by code, but do not set. |
| `TEST_DATABASE_URL`, `STORAGE_DIR` | Test / local-disk only. |
| Any mainnet key, any key that holds real funds | This is a testnet deployment. |

`/api/health` reports `dangerousKeysAbsent: false` if `DEPLOYER_PRIVATE_KEY`, `ADMIN_PRIVATE_KEY` or `CRE_ETH_PRIVATE_KEY` is present.

## Core

| Name | Comes from | Scope | Secret | Need | Notes |
|---|---|---|---|---|---|
| `DATABASE_URL` | Neon dashboard: **pooled** connection string (host has `-pooler`) | P V | yes | REQUIRED | Append `?sslmode=require&pgbouncer=true&connection_limit=5&connect_timeout=15`. Use a separate Neon branch for Preview. |
| `DIRECT_URL` | Neon: **non-pooled** string | local only (not needed at runtime) | yes | for migrations | Used by `npm run db:migrate:direct`, never at build. Do not add to Vercel unless you run migrations from CI. |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | P V | yes | REQUIRED | >= 32 chars or the app refuses to sign sessions in production. Also keys OAuth-token encryption: rotating it signs everyone out and invalidates stored Instagram tokens. Use different values for P and V. |
| `CRON_SECRET` | `openssl rand -hex 32` (or the node one-liner above) | P V | yes | REQUIRED | Vercel Cron sends it as `Authorization: Bearer`. Without it every cron endpoint answers 401 (indexer and snapshots never run). Also lets CRE call `/api/snapshots/refresh`. >= 16 chars. |
| `ADMIN_WALLETS` | Comma-separated lowercase 0x addresses of the team admins | P V | no | REQUIRED | They get role ADMIN at sign-in. |
| `SIWE_DOMAIN` | Optional override | P V | no | optional | Default is the request `Host`, which is correct for production, custom domains and every preview URL. Set only when a proxy rewrites Host. If set it must equal the host the user's browser is on, so do **not** set it on Preview. |
| `NEXT_PUBLIC_TEST_DEPLOY` | `1` | P V | no | REQUIRED for the test deploy | Shows the TESTNET banner/footer, adds `noindex` meta + `X-Robots-Tag`, `robots.txt` Disallow all. Build-time. |
| `RATE_LIMIT` | `0` disables | P V | no | optional | Rate limiter (Postgres `RateLimitBucket`) is on by default in production. |

## Chain (Arc testnet)

| Name | Comes from | Scope | Secret | Need |
|---|---|---|---|---|
| `ARC_RPC_URL` | Arc docs (`https://rpc.testnet.arc.network`) | P V | no | optional (default is that URL) |
| `ARC_CHAIN_ID` | `5042002` | P V | no | optional |
| `USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` | P V | no | optional |
| `ESCROW_ADDRESS` | Output of the contracts deploy | P V | no | REQUIRED (money endpoints answer 503 without it) |
| `ESCROW_DEPLOY_BLOCK` | Block of the escrow deploy tx | P V | no | REQUIRED in practice (indexer starts there; 0 makes the first sync crawl) |
| `PROFILE_ADDRESS`, `REFERRAL_ADDRESS`, `REPORT_RECEIVER_ADDRESS` | contracts deploy | P V | no | only if the module is on |
| `CIRCLE_FAUCET_URL` | `https://faucet.circle.com` | P V | no | optional |
| `PLATFORM_CAMPAIGNER_FEE_BPS`, `PLATFORM_CREATOR_FEE_BPS`, `RETENTION_DAYS`, `HIGH_VALUE_THRESHOLD_USDC` | tuning | P V | no | optional |

Client-side (inlined at build): `NEXT_PUBLIC_ARC_RPC_URL`, `NEXT_PUBLIC_ARC_CHAIN_ID`, `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_FAUCET_URL` (all optional; defaults are the Arc testnet values and the wallet otherwise reads `/api/chain/config`). The escrow address reaches the browser through `/api/chain/config`, no public var is needed.

## World ID (staging)

| Name | Comes from | Scope | Secret | Need |
|---|---|---|---|---|
| `WORLD_ID_APP_ID` | World Developer Portal (staging app) | P V | no | REQUIRED for creator sign-up |
| `WORLD_ID_RP_ID` | Developer Portal | P V | no | REQUIRED |
| `WORLD_ID_SIGNING_KEY` | Developer Portal RP signing key | P V | **yes** | REQUIRED (server-only) |
| `WORLD_ID_ENVIRONMENT` | `staging` | P V | no | REQUIRED for the test deploy |
| `WORLD_ID_ACTION` / `NEXT_PUBLIC_WORLD_ACTION` | `clippo-creator-signup` (same value) | P V | no | optional |
| `NEXT_PUBLIC_WORLD_LEVEL` | `orb` (default) or `device` | P V | no | optional |
| `WORLD_ID_ONCHAIN_VERIFIER`, `WORLD_ID_ONCHAIN_RPC_URL` | World docs | P V | no | optional |
| `WORLD_CHAIN_RPC_URL` | World Chain RPC | P V | no | optional (AgentBook lookup) |

## AI

| Name | Comes from | Scope | Secret | Need |
|---|---|---|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | P V | **yes** | REQUIRED (verifier, wizard, assistants; also AI video) |
| `LLM_PROVIDER` | `gemini` | P V | no | optional |
| `GEMINI_TEXT_MODEL`, `GEMINI_VIDEO_MODEL`, `GEMINI_TIMEOUT_MS`, `GEMINI_THINKING_LEVEL` | tuning | P V | no | optional |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | console.anthropic.com | P V | yes | optional (if both keys are set Anthropic wins) |
| `LLM_RPM_LIMIT`, `LLM_MAX_CONCURRENCY`, `LLM_MAX_RETRIES`, `LLM_CACHE_TTL_SECONDS`, `LLM_MAX_INPUT_CHARS`, `LLM_QUEUE_TIMEOUT_MS`, `VERIFIER_CONFIDENCE_THRESHOLD` | tuning | P V | no | optional |
| `VIDEO_GEN_PROVIDER`, `VIDEO_GEN_URL`, `VIDEO_GEN_KEY`, `VIDEO_GEN_MAX_BYTES` | only for the generic http provider | P V | key: yes | optional |

LLM throttle/queue/cache are per function instance (in memory). On Vercel several instances run in parallel, so the effective Gemini RPM can exceed `LLM_RPM_LIMIT`; 429s are retried with backoff and the Postgres rate limiter on LLM routes caps abuse globally. Keep `LLM_RPM_LIMIT` at or below the free-tier limit divided by the expected instance count, or use a paid key.

## Platforms

| Name | Comes from | Scope | Secret | Need |
|---|---|---|---|---|
| `YOUTUBE_API_KEY` | Google Cloud (YouTube Data API v3) | P V | yes | REQUIRED for YouTube clips/views |
| `X_BEARER_TOKEN` | X developer portal | P V | yes | optional |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Meta developer app | P V | secret: yes | optional |
| `INSTAGRAM_REDIRECT_URI` | `https://<host>/api/channels/instagram/oauth/callback` | P V | no | with Instagram (must match Meta exactly; one URL per host, so Preview needs its own app or skip Instagram on Preview) |
| `INSTAGRAM_POST_CONNECT_URL` | `/` | P V | no | optional |
| `ANOMALY_MIN_DELTA`, `ANOMALY_MULTIPLIER`, `APPEAL_SLA_HOURS` | tuning | P V | no | optional |

## Storage (source clips / AI video)

| Name | Comes from | Scope | Secret | Need |
|---|---|---|---|---|
| `STORAGE_PROVIDER` | `blob` | P V | no | REQUIRED on Vercel (auto when `VERCEL` is set, local disk is refused) |
| `BLOB_STORE_ID` | Vercel dashboard > Storage > Blob > create a **private** store, connect to the project (OIDC auth, default) | P V (D via pull) | no | REQUIRED, or use the token below |
| `BLOB_READ_WRITE_TOKEN` | Same store, token auth | P V | **yes** | alternative to `BLOB_STORE_ID` |
| `SOURCE_MAX_BYTES` | default 500 MB; suggest `209715200` (200 MB) for the test | P V | no | optional |

## Fiat on-ramp (Transak, staging)

| Name | Comes from | Scope | Secret | Need |
|---|---|---|---|---|
| `TRANSAK_API_KEY`, `TRANSAK_API_SECRET` | Transak staging dashboard | P V | secret: yes | optional (on-ramp answers 503 without) |
| `TRANSAK_ENV` | `staging` | P V | no | REQUIRED if on-ramp used |
| `TRANSAK_REFERRER_DOMAIN`, `TRANSAK_REDIRECT_URL`, `TRANSAK_NETWORK` | Transak | P V | no | optional (referrer defaults to the request host) |

## Optional modules (all default OFF)

`FEATURE_TOKENIZATION`, `FEATURE_REFERRAL`, `FEATURE_STATUS_LADDER` = `false` (or unset), `REFERRAL_CUT_BPS`, `REFERRAL_CAP_USDC`, `REFERRAL_COOLDOWN_HOURS`. Turning one on may need `UPDATER_PRIVATE_KEY` (see the do-not-set table) and a contracts review (`contracts/LEGAL_REVIEW.md`).

## Agent Pass

`AGENT_PASS_DEMO=1` (P V, not secret, REQUIRED for the test deploy). Leave `AGENT_PASS_PRIVATE_KEY` unset.

## Vercel-provided (do not set)

`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_REGION`, `NODE_ENV=production` (all deployments, including previews).

## Minimal set for the first deploy

`DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_WALLETS`, `NEXT_PUBLIC_TEST_DEPLOY=1`, `ESCROW_ADDRESS`, `ESCROW_DEPLOY_BLOCK`, `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY`, `WORLD_ID_ENVIRONMENT=staging`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `AGENT_PASS_DEMO=1`, `STORAGE_PROVIDER=blob` + Blob store connected.
