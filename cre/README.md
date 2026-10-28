# Clippo CRE settlement workflow

Chainlink CRE (TypeScript SDK `@chainlink/cre-sdk` 1.23) workflow, `workflows/clippo-settlement/`.

Flow (cron, daily):
1. Each node calls `GET {backendUrl}/api/snapshots/daily` -> `[{campaignId, creator, cumulativeViews}]`.
2. `snapshot.ts` validates and canonicalises the rows (sorted, deduped, checksummed addresses) into a string; nodes must return an identical string (`ConsensusAggregationByFields`, `identical` per field). The backend therefore must serve one frozen snapshot per day.
3. The agreed rows are ABI-encoded as `(uint256 campaignId, address creator, uint256 cumulativeViews)[]`, signed into a report (`runtime.report`), and written with `EVMClient.writeReport` to `ClippoReportReceiver`, which the forwarder calls `onReport` on -> `ClippoEscrow.reportViews` (credits only the delta, capped by the pool).

## Setup

```
cd cre
npm install                # or bun install
npm run typecheck          # tsc, passes
```

Install the CRE CLI (https://docs.chain.link/cre/getting-started/cli-installation), `cre login`, and Bun (needed by the CLI for compilation).

Edit `workflows/clippo-settlement/config.staging.json`:
- `backendUrl`: Clippo backend base URL (must be reachable by the CRE nodes / your machine during simulation)
- `evm.receiverAddress`: deployed `ClippoReportReceiver` (see `../contracts/README.md`)
- `evm.chainSelectorName`: `arc-testnet` (present in SDK 1.23 chain selectors)
- `schedule`: 6-field cron, default `0 30 0 * * *` (daily 00:30 UTC)

Edit `project.yaml` (Arc testnet RPC URL, (no owner address needed)) and copy `.env.example` to `.env` with a funded testnet key.

## Simulate

```
# dry run (no tx broadcast)
cre workflow simulate ./workflows/clippo-settlement --target staging-settings
# broadcast the report on-chain
cre workflow simulate ./workflows/clippo-settlement --target staging-settings --broadcast
```

(equivalent: `npm run simulate` / `npm run simulate:broadcast`). Select the cron trigger when prompted.

For simulation, the CRE simulator's mock forwarder address must be set as `forwarder` on `ClippoReportReceiver` (`setForwarder`, or `FORWARDER_ADDRESS` at deploy) and the receiver registered via `ClippoEscrow.setReportAdapter`. The mock forwarder passes no workflow metadata, so the receiver must be deployed with `INSECURE_SKIP_WORKFLOW_CHECK=true` (or `setWorkflowCheckSkipped(true)`). For production use the KeystoneForwarder address for the target chain from the CRE docs, set `EXPECTED_WORKFLOW_OWNER` (required; receiver fails closed without it), optionally `setExpectedWorkflowId` after `cre workflow deploy`, and `setWorkflowCheckSkipped(false)`. See `../contracts/README.md`.

## Status

See `../docs/tracks/CRE.md` (requirements checklist, evidence, live path, unverified items) and `../docs/tracks/cre-simulation-output.txt`.
`cre workflow simulate` needs `cre login`; run `bash scripts/simulate-local.sh` once logged in. CLI-free evidence: `bash scripts/capture-evidence.sh`.
The workflow reads the frozen feed `GET /api/snapshots/daily` (`{day, hash, rows}`), not `/latest`.
