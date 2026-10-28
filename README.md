# Clippo

Clippo is a clipping-and-bounty marketplace. Brands fund a USDC pool, World-ID-verified creators post clips, an AI verifier checks each clip against the brand's story, and payouts settle on-chain (Arc) with views delivered by a Chainlink CRE workflow. Creators claim their own money; unspent funds return to the brand. An AI agent proposes, but never moves money alone.

Built for ETHGlobal. Tracks: Chainlink CRE, World Agent Pass, World IDKit, Arc. See `docs/TRACKS.md`.

| Doc | Purpose |
| --- | --- |
| `docs/ARCHITECTURE.md` | Diagrams (architecture + money flow) |
| `docs/TRACKS.md` | Track to code mapping, failure paths, integration debrief template |
| `docs/DEMO_SCRIPT.md` | Under-5-minute video script |
| `docs/RUNBOOK.md` | Deploy, env, CRE simulate, seed, what replaced the mocks |
| `docs/SUBMISSION_CHECKLIST.md` | What to submit |
| `web/API.md` | Full HTTP API reference |
| `contracts/README.md`, `cre/README.md` | Contract and workflow details |

## Layout

```
contracts/  Foundry: ClippoEscrow, ClippoReportReceiver, MockUSDC, Deploy script, tests
cre/        Chainlink CRE TypeScript workflow (clippo-settlement)
web/        Next.js app + /api routes + Prisma (Postgres; PGlite via `npm run db:local` for dev)
design/     Visual direction
```

## Quickstart

Prereqs: Node 20+, Foundry, and for CRE the `cre` CLI and Bun.

```bash
# contracts
cd contracts && forge build && forge test

# web
cd web && cp .env.example .env.local && npm install
npx prisma migrate deploy
npm run dev            # http://localhost:3000, (run `npm run doctor` first: every integration is real)
npm test && npm run typecheck

# cre
cd cre && npm install && npm run typecheck
cp .env.example .env   # then edit workflows/clippo-settlement/config.staging.json and project.yaml
npm run simulate       # needs cre CLI; see docs/RUNBOOK.md
```

## Environment variables

| Var | Where | Purpose | Default / if missing |
| --- | --- | --- | --- |
| `DATABASE_URL` | web | Prisma DB (Postgres) | required; `npm run db:local` prints a local URL |
| `SESSION_SECRET` | web | Cookie HMAC secret | required in production |
| `ADMIN_WALLETS` | web | Comma list of wallets that become ADMIN | placeholder in example |
| `ALLOW_WALLET_HEADER` | web | Accept dev `x-wallet` header | on outside production |
| `CRON_SECRET` | web | Lets cron/CRE call `POST /api/snapshots/refresh` | empty |
| `LLM_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | web | AI verifier + campaign writer + assistants. Free Gemini key: https://aistudio.google.com/apikey (default model `gemini-3.5-flash-lite`). Auto: only one key -> that provider; both -> anthropic | neither set: 503 NOT_CONFIGURED |
| `LLM_RPM_LIMIT`, `LLM_MAX_CONCURRENCY`, `LLM_MAX_RETRIES`, `LLM_CACHE_TTL_SECONDS`, `LLM_MAX_INPUT_CHARS` | web | Free-tier protection (throttle, queue, backoff, cache, truncation); on quota exhaustion the UI shows "AI quota exceeded, try again" and the verifier sends clips to human review | sensible defaults |
| `VERIFIER_CONFIDENCE_THRESHOLD` | web | Below this, verdict is NEEDS_HUMAN | `0.75` |
| `WORLD_ID_APP_ID`, `WORLD_ID_ACTION` | web | World ID verify | missing: 503 NOT_CONFIGURED; action `clippo-creator-signup` |
| `YOUTUBE_API_KEY` | web | YouTube Data API v3 | missing: 503 NOT_CONFIGURED |
| `NEXT_PUBLIC_DEMO_ADMIN_WALLET` | web | Demo admin wallet used by the UI (must match `ADMIN_WALLETS`) | `0xAdmin...0001` |
| `CRE_ETH_PRIVATE_KEY` | cre | Key for `simulate --broadcast` (testnet only) | empty |
| `PRIVATE_KEY`, `ARC_RPC_URL` | contracts (shell) | Deploy | required |
| `USDC_ADDRESS` | contracts (shell) | Existing USDC | omitted: deploys MockUSDC |
| `TREASURY`, `ADMIN`, `FORWARDER_ADDRESS` | contracts (shell) | Fee sink, extra admin, CRE forwarder | deployer |
| `CAMPAIGNER_FEE_BPS`, `CREATOR_FEE_BPS` | contracts (shell) | Fees, max 50 bps each | 25 / 25 |

## Honest status

Updated after the UI/demo pass. "Verified" below means exercised in this repo (unit/integration tests against stubbed HTTP, or by running the app locally); nothing here was exercised against live third-party credentials unless stated.

| Area | Status |
| --- | --- |
| Escrow contracts (3 modes, fees, reject refund, deadlines) | Real code with Foundry tests. `contracts/broadcast/Deploy.s.sol/5042002` holds a local broadcast record for Arc testnet; confirm the addresses on the explorer before quoting them (not re-verified here). |
| `ClippoReportReceiver` (IReceiver adapter) | Real code, tested with a stand-in forwarder. |
| CRE workflow | Code typechecks against the SDK and has a snapshot-contract test. `cre workflow simulate` has NOT been run in this repo; config and project YAML are best-effort. |
| Backend API + Prisma (Postgres) | Real. `npm test` runs the API against a throwaway Postgres. Session auth is SIWE in production; the unsigned dev sign-in only works outside production. |
| AI verifier / campaign writer | Real Claude or Gemini calls (`LLM_PROVIDER`; Gemini runs on the free AI Studio key, limits in docs/RUNBOOK.md; AI video generation is paid-tier only); without a key the endpoints answer 503 `NOT_CONFIGURED` (no keyword mock). Exercised against stubbed responses only. |
| World ID | IDKit widget + backend `rp-signature` / `verify` (v4) are wired. Needs `WORLD_ID_*`; not run against the live Developer Portal here. |
| World Agent Pass | Agent identity, AgentBook lookup, signed proposals and audit trail are implemented (`src/lib/agentpass`); the human World ID check gates release. Not run against a live AgentBook here. |
| Web to escrow (fund / claim / close) | Real wallet transactions through viem when `ESCROW_ADDRESS` is set, then server-side receipt verification. Without it money-moving calls refuse with 503. The only fake tx hashes are behind the explicit `NEXT_PUBLIC_DEMO=1` flag (`hooks.ts` `demoTx`); do not record with it on. |
| Backend to chain (approve/reject/close/split) | Signer + indexer exist (`src/lib/chain`); need a funded signer key and `ESCROW_ADDRESS`. Not exercised on a live chain here. |
| Platforms | YouTube (Data API), X (API v2), Instagram (creator OAuth) are real clients, each needing its key; tested against stubs only. |
| Views to chain | `/api/snapshots/latest` emits the numeric on-chain campaign id the CRE workflow expects (shared fixture test). Live CRE broadcast not run. |
| UI | Paper and Night themes, mobile-first. `npm run check:overflow` (no horizontal overflow across routes x widths x themes) and the device screenshot sweep in `design/shots/senior` (see `web/scripts/shoot-senior.mjs`). With `NEXT_PUBLIC_DEMO=1` and no API the UI falls back to `src/ui-mocks` and shows a demo flag. |
| Seed data | `web/scripts/seed-demo.mjs` writes clearly labelled `[SEED]` rows through Prisma (campaigns, verified creators, verdicts incl. approve/reject/needs-human, an appeal, view snapshots, a hire workspace). Chain-dependent rows only with `ESCROW_ADDRESS` or the local-only `--ui-only` flag; no tx hashes or payouts are invented. |
| Arc Studio | Not verifiable from the repo; project URL is a placeholder in `docs/SUBMISSION_CHECKLIST.md`. |
