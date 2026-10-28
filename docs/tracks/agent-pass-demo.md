# World Agent Pass: demo clicks

Setup once (see the final list of accounts in the report): set `AGENT_PASS_PRIVATE_KEY` and register its address
(`npx @worldcoin/agentkit-cli register <address>`), or for a screen-only run set `AGENT_PASS_DEMO=1` (fake human, labelled "demo").
Real World ID checks need `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY`. Without them the sheet says "Not configured" and nothing changes.

Prepare: a LIVE human-split campaign with the approver set to "me and admin" and at least one approved clip. Open the campaign desk
as the campaigner (and the bench as an admin in a second window).

## Happy path

1. Desk, campaign row: click **Ask Claude to propose** (needs `ANTHROPIC_API_KEY`; without it you get 503 NOT_CONFIGURED, and **Propose without AI** is the non-AI option). The agent is delegated (AgentBook check) and proposes. A banner says nothing is payable yet.
2. Scroll to **Agent Pass activity**: the agent, the proposal (hash, creators, total), Claude's rationale, confidence, flags and a one-line reason per creator, and audit rows "Agent delegated", "Agent proposed".
3. Click **Approve agent's split (1 of 2)**, complete the World ID check. Log row "Human approved", proof valid. Status: awaiting admin.
4. Bench, tab Splits: click **Review the agent's split (admin)**, complete your own World ID check. Status: both approved, awaiting chain. The panel shows both approvals.

## Failure paths (each one leaves the split undone; show the audit log after each)

Use a fresh proposal for each (click **Ask Claude again**).

| Click | What you do | Expected message and log row |
| --- | --- | --- |
| AI proposal rejected | Run the unit test `llm-proposer.test.ts` (over-pool, non-eligible, duplicates) or point the key at a failing model | Proposal source shows the non-AI split with the rejection reason. Log: "AI proposal rejected, non-AI split used" with the violation |
| Cancelled | Open the World ID sheet and press Cancel or Esc | "Split not approved. You cancelled the check." Log: Check cancelled, proof cancelled |
| Expired check | Let the sheet time out (or in the demo build "Let it expire") | "...check expired..." / 403. Log: Check expired |
| Repeated proof | Demo build: "Reuse an old proof". Real: use a proof already spent | 409 "That World ID proof was already used". Log: Proof reused, proof replayed |
| Expired proposal | Wait 30 minutes after the agent proposes (or set `expiresAt` in the DB), then approve | 410 "The agent's proposal expired". Log: Proposal expired. The Approve button disappears; ask again |
| Wrong approver | As the admin on a campaign set to "campaigner only", or as a different campaigner, call `POST /api/campaigns/:id/split` | 403 Wrong approver. Log: Wrong approver |
| Split changed | Call `POST /api/campaigns/:id/split` with the agent's `agentProposalId` but one amount edited (curl or devtools) | 409 "not what the agent proposed (hash mismatch)". Log: Split changed |
| Already released | After both approvals, click approve again or repeat the request | 409 "already approved by everyone". Log: Already released |

After each failure show: the activity panel row, `GET /api/campaigns/:id/split` has no new approval, `GET /api/creator/earnings` shows no new payout.

## Guardrail talking point

Show `src/lib/agents/guardrail.test.ts` (Agent Pass block): the agent module is pure, agent routes can only write the agent tables, and the split route
verifies and consumes a World ID proof before it can create an approval. Payouts only come from the escrow's on-chain event.
