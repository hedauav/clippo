# Track: Chainlink CRE ("Best workflow with CRE", $1,500, ETHGlobal Mumbai)

Owner dir: `cre/` (plus `web/scripts/freeze-snapshot.mjs` and `web/src/app/api/snapshots/daily`). Researched and built 2026-10-28.

## Prize requirements (source: https://ethglobal.com/events/mumbai/prizes/chainlink)

> Goal: build, simulate, or deploy a CRE workflow used as an orchestration layer in your project. Simulation alone is acceptable.
> Requirements: the workflow must connect at least one blockchain to an external API, system, data source, LLM, or AI agent. Show a successful simulation via the CRE CLI or a live deployment, and the workflow must be meaningfully used in the project.

The page lists no separate judging criteria. So the proof judges need is `cre workflow simulate` output (or a live deployment). Our emulation output (below) is supporting evidence only, NOT the CLI simulation.

## Current CRE facts (docs.chain.link/cre, fetched 2026-10-28)

| Item | Finding |
| --- | --- |
| CLI | `cre` v1.39.0. Windows native: `irm https://app.chain.link/cre/install.ps1 \| iex`, or the zip from https://github.com/smartcontractkit/cre-cli/releases (verify checksum). |
| Verified locally | Downloaded `cre_windows_amd64.zip` v1.39.0, SHA-256 `bce12d90866edf6125664129e1b241f98c823ef577ed6530232053bdf1b86c64` matches the GitHub release digest. `cre version` runs. |
| Runtime deps | Bun >= 1.2.21 (SDK compiles with bun + Javy to WASM). bun 1.4.4 installed via npm in a scratch dir. |
| TS SDK | `@chainlink/cre-sdk` 1.23.0 (latest on npm; already in `cre/package.json`). |
| Account | Free account at https://app.chain.link/cre. **`cre init` and `cre workflow simulate` both refuse to run unless logged in (`cre login`, browser + 2FA) or `CRE_API_KEY` is set.** Verified: both abort with "Authentication required". |
| Deploy | `cre workflow deploy` needs Early Access deploy approval (`cre account access` or https://cre.chain.link/request-access). Simulation does not. |
| Arc support | **Arc Testnet is supported** (chain name `arc-testnet`, in SDK 1.23 selectors). Forwarders (https://docs.chain.link/cre/guides/workflow/using-evm-client/supported-networks-ts): simulation MockKeystoneForwarder `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1`, production KeystoneForwarder `0x76c9cf548b4179F8901cda1f8623568b58215E62`. Docs: confirm tenant availability with `cre workflow supported-chains` after login. |
| Sim flags | `cre workflow simulate <dir> --target <t> [--non-interactive --trigger-index N] [--http-payload JSON or @file] [--broadcast]`; `CRE_ETH_PRIVATE_KEY` in `.env` for writes; without `--broadcast` writes are a dry run. |
| Config shape | `project.yaml`: `<target>: { rpcs: [{chain-name, url}] }` (`account.workflow-owner-address` is multisig-only/optional). `workflow.yaml`: `<target>: { user-workflow.workflow-name, workflow-artifacts.{workflow-path,config-path,secrets-path} }`. |
| Consensus | `consensusMedianAggregation`, `consensusIdenticalAggregation`, `consensusCommonPrefixAggregation`, `ConsensusAggregationByFields({field: median/identical/commonPrefix/ignore})`. |
| Write path | `runtime.report({encodedPayload, encoderName:"evm", signingAlgo:"ecdsa", hashingAlgo:"keccak256"})` then `EVMClient.writeReport(runtime,{receiver, report, gasConfig})`; the forwarder calls `IReceiver.onReport(metadata, report)`. Check both `txStatus` and `receiverContractExecutionStatus`. |
| Triggers | Cron (6-field) and HTTP (`authorizedKeys` required for deployed workflows; none for simulation). One HTTP handler max per workflow. |

Doc caveat: the simulate docs say the simulator's mock forwarder "doesn't call your onReport()". We tested the Arc mock forwarder on-chain (anvil fork): it DOES call `onReport` and the escrow credits. The CLI's own behaviour is untested (login).

## Requirement checklist

| # | Requirement | Source | Status |
| --- | --- | --- | --- |
| 1 | Workflow connects a blockchain to an external data source | Prize page | DONE in code: HTTP read of `/api/snapshots/daily`, EVM `writeReport` to Arc |
| 2 | Successful simulation via CRE CLI OR live deployment | Prize page | **BLOCKED on user: needs `cre login`.** Single command ready: `bash scripts/simulate-local.sh` |
| 3 | Meaningfully used in the project | Prize page, PRD 6.1 | DONE by design: replaces the admin wallet writing view counts; receiver is the escrow's only reportAdapter |
| 4 | Workflow compiles with the CLI toolchain | CRE SDK | VERIFIED: `cre-compile` (typecheck, runtime-compat check, Javy WASM, 2.5 MB) passes with bun 1.4.4 |
| 5 | project.yaml / workflow.yaml match canonical format | CRE docs | DONE from docs; `cre init` could not be run (login), so not diffed against init output |
| 6 | Consensus across nodes on one frozen snapshot | PRD 6.1 step 2 | DONE: per-field `identical` on `{day, hash, rows}`; backend serves an immutable completed-day snapshot |
| 7 | Report via forwarder to `IReceiver`; escrow credits only new views within pool cap | PRD 6.1 step 3 | VERIFIED on anvil fork of Arc testnet through the real Arc MockKeystoneForwarder (evidence below) |
| 8 | Empty feed, large batch, replay, staleness | task | DONE + evidence (empty no-op; 60 rows into 3 reports of 25; replay credits 0; 5-day-old day rejected) |
| 9 | HTTP trigger in addition to cron | task | DONE (trigger index 1, optional `{"day":"YYYY-MM-DD"}`); simulation untested (login) |
| 10 | Backend freeze of one snapshot per day | PRD 6.1 step 1 | DONE (below); DB-backed route not run (needs Postgres) |
| 11 | Live deployment on Arc testnet | optional | BLOCKED on Early Access + funded key + Arc contract deploy |

## What was built

- `cre/workflows/clippo-settlement/main.ts`: handler 0 = cron (daily 00:30 UTC), handler 1 = HTTP. Each node fetches `{day, hash, rows}`, validates and canonicalises rows (`snapshot.ts`), returns `{day, hash = keccak256(rows), rows}`; `ConsensusAggregationByFields` with `identical` on every field, so divergence fails consensus instead of being signed. After consensus: staleness guard (`maxStalenessDays`, default 2, DON time `runtime.now()`), empty feed is a no-op, rows chunked by `maxRowsPerReport` (25), one signed report per chunk, `txStatus` and `receiverContractExecutionStatus` both checked.
- Replay safety: `ClippoEscrow.reportViews` ignores `cumulativeViews <= last`, so re-sending a day credits 0 (shown).
- Backend (additive only): `web/src/lib/snapshots.ts` gains `frozenSnapshot(day)`, `buildFrozenSnapshot`, `previousDay`, and an optional `asOfDay` arg on `latestPerSubmission`/`latestSnapshots`. New `GET /api/snapshots/daily[?day=YYYY-MM-DD]` returns `{day, hash (sha256), rows}` with `ETag`; default is yesterday (UTC), a completed day that `refreshSnapshots` no longer writes to; 400 for invalid or incomplete days. No schema change. `GET /api/snapshots/latest` untouched.
- `web/scripts/freeze-snapshot.mjs`: `BACKEND_URL=... CRON_SECRET=... node scripts/freeze-snapshot.mjs [--day D] [--out f.json]` refreshes, then fetches/saves the frozen day. Schedule at about 00:10 UTC, before the CRE cron.
- `cre/scripts/`: `mock-backend.mjs` (shared fixture in the real envelope; modes fixture, empty, stale, large, bump), `local-chain.sh` (anvil-fork deploy using the contracts' `DeployMock.s.sol` and `Deploy.s.sol`, seeds campaigns 1..12, approves 7 and 12, patches `receiverAddress`), `simulate-local.sh` (the real `cre workflow simulate` run), `emulate-delivery.mts` and `capture-evidence.sh` (CLI-free evidence).
- Tests: `cd cre && npm test` 7 pass; `npm run typecheck` clean.

## Evidence (CLI-free emulation: `docs/tracks/cre-simulation-output.txt`)

Anvil fork of Arc testnet (real MockKeystoneForwarder present), fixture feed, rate $10 per 1k views, campaign 7 pool $500, campaign 12 pool $1 (25 bps fee):

- First delivery: campaign 7 `0x1111...` 1200 views = 12.000000 USDC; `0xABcd...` 300 views = 3.000000; campaign 12 `0xABcd...` 5000 views would be $50 but is credited 0.997500 (pool cap).
- Replay: every row `deltaViews=0 credited=0`. Bump +100 views: only the delta (1.000000) credited. Empty: "no-op". Stale: REJECTED. Large: 60 rows into 3 reports (25+25+10), all `failed=0`.

## Reproduce

```
cd cre && npm install
# CLI-free evidence (needs foundry + node 22+; export PATH="$HOME/.foundry/bin:$PATH")
bash scripts/capture-evidence.sh | tee ../docs/tracks/cre-simulation-output.txt
# REAL simulation (needs cre + bun on PATH, and `cre login` done)
bash scripts/simulate-local.sh
# manual equivalent:
#   anvil --fork-url https://rpc.testnet.arc.network --port 8545 --chain-id 5042002
#   bash scripts/local-chain.sh; set -a; source scripts/.local-chain.env; set +a
#   node scripts/mock-backend.mjs &
#   cre workflow simulate ./workflows/clippo-settlement --target staging-settings --non-interactive --trigger-index 0 --broadcast
#   cre workflow simulate ./workflows/clippo-settlement --target staging-settings --non-interactive --trigger-index 1 --http-payload '{}' --broadcast
```

The local `CRE_ETH_PRIVATE_KEY` is the public anvil account #0 key (no value on any real network).

## Live path on Arc testnet (supported)

1. `cre login`; `cre account access` (Early Access) until `cre whoami` shows deploy access.
2. Deploy contracts with `contracts/script/Deploy.s.sol`, `FORWARDER_ADDRESS=0x76c9cf548b4179F8901cda1f8623568b58215E62` (production). Use the mock `0x6E9E...` only while running `simulate --broadcast` against the real chain. Arc gas is USDC (https://faucet.circle.com).
3. Put the public backend URL in `config.production.json` and the receiver in `evm.receiverAddress`; run the daily freeze job.
4. `cre workflow simulate ./workflows/clippo-settlement --target production-settings --broadcast`, then `cre workflow deploy ./workflows/clippo-settlement --target production-settings` (add HTTP `authorizedKeys` first), and `setForwarder` to the production forwarder.

## Accounts and credentials the user must create

- CRE account at https://app.chain.link/cre, then `cre login` (needed even for simulation). Optional `CRE_API_KEY` for headless use.
- Deployment only: Early Access approval (`cre account access`).
- A funded Arc testnet key (USDC gas, Circle faucet) as `CRE_ETH_PRIVATE_KEY` for real-chain broadcast/deploy. Never commit it.
- Forwarder addresses above; confirm with `cre workflow supported-chains`.
- Public backend URL reachable by CRE nodes, and `CRON_SECRET` for the freeze job.

## Contract requests (for the contracts agent; not edited here)

1. DONE (contracts agent): `ClippoReportReceiver.onReport` now validates the forwarder metadata (docs: building-consumer-contracts, ReceiverTemplate pattern). Metadata is 64 bytes from the production KeystoneForwarder: workflowId bytes32 | workflowName bytes10 | workflowOwner address | reportId bytes2 (the 109-byte header is the signed report header, not the `metadata` arg). Workflow owner is REQUIRED (fail closed when unset); workflow id and name (bytes10) optional; owner-only setters with events. The CRE docs state the simulation MockKeystoneForwarder passes NO workflow metadata, so simulation needs the explicit test-only flag. Tests: `contracts/test/ClippoReportReceiver.t.sol`.
   - Simulation: deploy with `INSECURE_SKIP_WORKFLOW_CHECK=true` (local scripts with `ALLOW_ANY_CHAIN=true` default to it); `FORWARDER_ADDRESS=0x6E9E...`.
   - Production: `FORWARDER_ADDRESS=0x76c9...`, `EXPECTED_WORKFLOW_OWNER=<your CRE account/workflow owner address>`; after `cre workflow deploy` call `setExpectedWorkflowId(<id>)` (and optionally `setExpectedWorkflowName`); `setWorkflowCheckSkipped(false)`. Moving an existing simulation deployment to production: `setForwarder`, `setExpectedWorkflowOwner`, `setWorkflowCheckSkipped(false)`.
   - Unverified: the exact owner address/format shown by the CRE tooling, and that production metadata matches the documented layout (not tested against a live KeystoneForwarder).
2. Optional: include the report metadata (execution id) in `ReportProcessed` for audit.

## Unverified and risks

- `cre workflow simulate`, `cre init`, HTTP-trigger simulation, and real multi-node consensus were NOT run (login required). The workflow typechecks and compiles; the node-mode `sendRequest` plus `ConsensusAggregationByFields` usage follows the SDK types and docs but is untested at runtime, as is `EVM_PB.ReceiverContractExecutionStatus`.
- project.yaml / workflow.yaml were written from the docs, not diffed against `cre init`.
- The `web` additions were only syntax-checked; DB-backed vitest needs a throwaway Postgres and was not run; `web` typecheck not run.
- Arc availability for deployed workflows in your tenant: confirm with `cre workflow supported-chains`.
- The Mumbai prize page states no judging criteria beyond the requirements above.
