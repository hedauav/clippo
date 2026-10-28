# Prize tracks to code

| Track | Where it lives | Status |
| --- | --- | --- |
| Chainlink, Best workflow with CRE | `cre/workflows/clippo-settlement/main.ts` (cron, HTTP read, consensus, signed report, `writeReport`), `snapshot.ts` (validate, canonicalise, ABI-encode), `workflow.yaml`, `config.staging.json`, `cre/project.yaml`; receiver `contracts/src/ClippoReportReceiver.sol`; data source `web/src/app/api/snapshots/{latest,refresh}/route.ts`, `web/src/lib/snapshots.ts` | Code typechecks. Compiles to WASM, typechecks; on-chain delivery verified on an anvil fork of Arc (see `docs/tracks/CRE.md`); `cre workflow simulate` needs `cre login` (not run). See id gap in `ARCHITECTURE.md`. |
| World, Agent Pass | `web/src/app/api/campaigns/[id]/split/route.ts` (fresh proof required before any payout is created), `web/src/lib/worldid/index.ts`, `web/src/components/DeskView.tsx` (`kind="agent-pass"`), `WorldCheck.tsx` | AI proposer is now a World AgentKit agent (`web/src/lib/agentpass/`, `/api/campaigns/:id/agent`, `/split/propose`): signed SIWE payload, AgentBook check, audit log, "Agent Pass activity" panel (desk and bench). Human approval needs a fresh World ID proof bound to the split hash. Failure paths tested. Needs the agent wallet registered in AgentBook and World ID credentials to run for real. See `docs/tracks/WORLD_AGENT_PASS.md`, `agent-pass-debrief.md`, `agent-pass-demo.md`. |
| World, Best Use of IDKit | `web/src/app/api/worldid/verify/route.ts` (validates server-side, stores unique nullifier, 409 `ALREADY_USED`), `lib/worldid/index.ts`, `components/{JoinView,AccountView,WorldCheck}.tsx`; `POST /api/submissions` requires a verified user | Same: IDKit widget not wired. |
| Arc, Smart Contracts with Advanced Stablecoin Logic | `contracts/src/ClippoEscrow.sol` (PerView, HumanSplit, PoolShare, two-sided fees capped at 50 bps, reject refund, deadline, pool cap), `contracts/test/ClippoEscrow.t.sol`, `script/Deploy.s.sol`, `abi/` | Contract code real and tested. Arc deployment and Arc Studio project not verified. Web integration is mocked. |

## Demo failure paths

Each path must leave the action undone. The backend enforces this; the UI shows the message.

| Path | How to trigger today (mock) | Expected result | Code |
| --- | --- | --- | --- |
| Cancelled | (Agent Pass also covers expired proposal, wrong approver, hash mismatch, already released: see `tracks/agent-pass-demo.md`.) In the World sheet press Cancel or Esc (`cancelled`); via API send `proof: "cancelled"` | Creator stays unverified; or split not created (403 `WORLD_ID_DENIED`) | `WorldCheck.tsx` (`WORLD_FAIL`), `worldid/verify`, `split` routes |
| Expired | "Let it expire" (`expired`); API `proof: "expired"` | Same, nothing changed | same |
| Repeated | "Reuse an old proof" (`repeated`). UI handles this locally before calling the API. Real mode: the same human on a second account gives 409 `ALREADY_USED` (nullifier unique) | Second account stays unverified | `AccountView/JoinView/DeskView.tsx`, `worldid/verify` route |

After a failure, show: user `verified` still false (`GET /api/auth/me`), and for split, `GET /api/creator/earnings` shows no new payouts and no on-chain call occurred. Note that in real World mode, replayed proofs for the split action are rejected by the Developer Portal per action/nullifier rules; confirm behavior with a real app before claiming it in the video.

Other safety paths worth showing: AI verdicts `NEEDS_HUMAN` for injection (`video id inject...`), off-topic `REJECT` (`bad...`), `EXCEEDS_POOL`, and escrow reverts (`PoolExceeded`, `NotApprover`, `BadState`).

## Integration debrief template (World Agent Pass)

Copy into the submission and fill in after the real integration.

```
Project: Clippo
Product used: World ID Agent Pass (+ IDKit for creator sign-up)
Integration type: official / SDK version: ____

1. What the agent proposes: AI proposes a payout split for a HUMAN_SPLIT campaign.
2. Where the human check sits: before POST /api/campaigns/:id/split creates payouts / before escrow approveSplit.
3. Who verifies: campaigner (and admin if CAMPAIGNER_AND_ADMIN) with a fresh check per approval.
4. Backend validation: endpoint ____, what is verified (nullifier, action, signal = hash of split) ____.
5. Journey tested: success [ ] cancelled [ ] expired [ ] repeated/reused [ ]; each leaves action undone [ ].
6. Setup time: ____ ; Docs clarity (1-5): ____
7. What worked well: ____
8. Friction / bugs / missing docs: ____
9. Fake-identity limitation: Agent Pass proofs use fake identities; demo only.
10. What we would do next: bind the proof signal to the exact split, two-party state for CAMPAIGNER_AND_ADMIN.
```

Known limitation to disclose: for `CAMPAIGNER_AND_ADMIN`, one approval is currently accepted (no two-party state in the backend); the contract does support two-party approval.
