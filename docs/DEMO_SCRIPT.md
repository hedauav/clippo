# Demo script (target 4:30, hard cap 5:00)

Setup before recording: `cd web && npm run db:local` (or a real Postgres), `npx prisma migrate deploy`, `npm run doctor`, then **stop anything else holding the single local DB connection** and seed: `node --env-file-if-exists=.env.local --env-file-if-exists=.env scripts/seed-demo.mjs --reset` (add `--ui-only` on a local DB to lay out screens without a chain), then `npm run dev`. Three browser profiles or sessions: Campaigner, Creator, Admin (admin wallet = a value from `ADMIN_WALLETS`). Be honest on camera about anything not exercised live (see the README status table). Never record with `NEXT_PUBLIC_DEMO=1`.

| Time | Screen | Say / do |
| --- | --- | --- |
| 0:00 | Landing | One line: brands fund a USDC pool, verified humans clip, AI checks, escrow on Arc pays, AI never moves money alone. |
| 0:20 | Arc Studio project (URL from checklist) then explorer | Show the Studio project and the deployed `ClippoEscrow`. State what was built in Studio. |
| 0:45 | Campaigner: `/desk/new` wizard | Type an idea, press the buttons (YouTube, Pool/Per view, approver), accept the AI story (note `aiMode`). |
| 1:15 | `/desk/[id]/fund` | Fund the pool in USDC on Arc testnet through the wallet; show the fee range. Without `ESCROW_ADDRESS` the button refuses with a not-configured message: say so, do not fake it. Campaign shows pending admin. |
| 1:35 | Admin: queue | Approve the campaign. Mention reject refunds the full pool. |
| 1:50 | Creator: `/join` | Press verify, World sheet. First show failures: Cancel, then Let it expire, then Reuse an old proof. Show account still unverified. Then Verify; account verified. |
| 2:30 | Creator: channel + submit | Verify channel (code in bio, real platform read). Submit a real clip: AI verdict with reason. Then open the seeded REJECT and NEEDS_HUMAN slips on `/slips/[id]` and the pending appeal. Without `ANTHROPIC_API_KEY`/`YOUTUBE_API_KEY` these calls answer 503: show the seeded verdicts instead and say so. |
| 3:15 | Admin or campaigner `/bench` | Resolve the NEEDS_HUMAN item by hand. |
| 3:30 | Campaigner `/desk` human split | Open a HUMAN_SPLIT campaign. The agent proposes the split (Agent Pass). Click release: Agent Pass sheet. Cancel: show "Split not released". Verify: payouts created. |
| 4:00 | Terminal in `cre/` | `curl <backend>/api/snapshots/latest`, then `npm run simulate`; show the report written (or say simulation output if not broadcast). Explain delta-only crediting. |
| 4:20 | Creator `/ledger` | Claim; show net of fee. Campaigner closes; unspent returned. |
| 4:40 | Architecture diagram | Close on `docs/ARCHITECTURE.md` diagram and tracks. |

Click path summary: `/desk/new` -> `/desk/[id]/fund` -> (admin) `/bench` approve -> (creator) `/join` -> `/wire` browse and submit -> `/slips/[id]` verdict and appeal -> `/desk` split -> `/ledger` claim -> close.

Seeded data (`web/scripts/seed-demo.mjs`, everything labelled `[SEED]`, wallets `0x5eed...`):
- Users: admin `0x5eed...01` (add to `ADMIN_WALLETS` to act as admin), campaigners `...02`/`...03`, five creators `...11`-`...15` (four World-verified with verified YouTube channels, one deliberately unverified to show the gate). Sign in as any of them with the dev sign-in outside production.
- Campaigns: one DRAFT always; per-view, human-split, pool-share (+ one rejected) only with `ESCROW_ADDRESS` configured or `--ui-only` (local DB, no chain fields, not fundable or claimable).
- Verdicts: APPROVE, REJECT (with a pending appeal), NEEDS_HUMAN, plus seven days of view snapshots for the approved clips.
- A hire workspace (brief, three creators in proposed/approved states, share link) and a shortlist; the script prints their share URLs.
- Not seeded, by design: tx hashes, funded pools, payouts, claims. Do those live: fund on Arc testnet, approve, then `POST /api/chain/sync` and `POST /api/snapshots/refresh`.
- Real integrations (World ID, Claude, YouTube) need their keys; without them those steps answer 503 NOT_CONFIGURED and must not be shown as working. The mock links (`bad...`, `inject...`) of the old script no longer exist: show the seeded REJECT and NEEDS_HUMAN verdicts on `/slips/[id]`, or submit real clips if keys are set.

Fallback: if the API is down the UI shows an error with retry (sample data only exists with `NEXT_PUBLIC_DEMO=1`, for screenshots, not for recording).
