# World Agent Pass: integration debrief (draft)

```
Project: Clippo
Product used: World AgentKit (the "Agent Pass" prize) for the AI split proposer; World ID (IDKit 4.x + Developer Portal v4 verify) for the human check
Integration type: official SDK, @worldcoin/agentkit 0.2.1 + @worldcoin/idkit 4.6 / idkit-core 4.6

1. What the agent does
   For a human-verified split campaign the agent proposes how to share the pool across creators with approved clips. It signs a
   SIWE (CAIP-122) AgentKit payload whose requestId is the keccak hash of the split and whose resource is the proposal endpoint.
   The proposal is written by Claude (advisory): it returns per-creator amounts and reasons as JSON; code re-checks every number
   (integers in micro-USDC, eligible creators, no duplicates, sum <= net pool, per-creator cap) and falls back to the deterministic
   planner, with an audit row, on any violation, timeout or malformed answer. Clip text is passed as delimited untrusted data.
   The agent has no code path that creates a payout, an approval, an attestation or a used proof (guardrail tests enforce it).

2. How the agent is tied to a human
   The agent wallet is registered in AgentBook (World Chain) with `npx @worldcoin/agentkit-cli register <address>`. The campaigner
   then delegates it to one campaign (POST /api/campaigns/:id/agent); the backend refuses unless AgentBook.lookupHuman(address)
   returns a human id. Each proposal is re-checked: schema, domain/uri, age, expiry, nonce replay, signature recovery, split binding.

3. Where the human check sits
   Before the escrow can be told to release: POST /api/campaigns/:id/split needs the approver's fresh World ID proof, bound to
   `split:<campaignId>:<splitHash>` (signal), verified at developer.world.org/api/v4/verify, consumed once. For two-party campaigns the
   admin does the same with their own proof on the identical hash. Payouts are created only by the on-chain event indexer.

4. Backend validation
   Agent side: validateAgentkitMessage + EIP-191 recovery + AgentBook lookup + DB-unique nonce.
   Human side: action `clippo-approve-split`, signal hash match, environment pinned server-side, proof hash and nullifier recorded.

5. Journeys tested (automated: src/lib/agentpass/agentpass.integration.test.ts; each leaves the action undone and writes an audit row)
   success [x]  cancelled [x]  expired proof [x]  expired proposal [x]  AI proposal rejected by code, fallback audited [x]  missing ANTHROPIC_API_KEY -> 503 [x]  repeated/replayed proof [x]
   wrong approver [x]  split changed after proposal (hash mismatch) [x]  already released [x]  revoked agent [x]  unregistered agent [x]
   Not yet run with a real World App: ____ (fill in after the live run)

6. Setup time: ____ ; Docs clarity (1-5): ____   (fill in after registering the agent for real)

7. What worked well
   - AgentBook plus a signed SIWE payload is a clean way to attribute a proposal to a human-backed agent.
   - The typed SDK (zod payload schema, validateAgentkitMessage, formatSIWEMessage) let us verify without writing crypto code.

8. Friction / gaps (from reading the docs and SDK; confirm against the live run)
   - "Agent Pass" is not a name in the docs; the product is AgentKit. The Mumbai prize page was not reachable while we researched.
   - AgentKit is built around x402 resource servers. Using it for an approval flow (not payment gating) meant calling the
     low-level helpers ourselves; the docs show no Next.js example.
   - Delegation is just registration: no scope (campaign, amount), expiry or revocation. We added per-campaign binding and revoke on our side.
   - AgentBook human ids are anonymous, so we cannot prove the registering human is the campaigner. The campaigner's World ID check is a separate step.
   - No documented fake or test identities for AgentBook; lookups resolve against World Chain mainnet only. We added an explicit demo mode (AGENT_PASS_DEMO) that is labelled everywhere.
   - `lookupHuman` returns null both for unregistered wallets and for RPC failures, so a flaky RPC looks like "not registered".
   - IDKit needs the signal passed into the preset to bind a proof to an approval; the backend rejects proofs that are not bound.

9. Fake-identity limitation
   Agent Pass proofs use fake identities, so this is demo only. Demo-mode records carry mode "demo" in the database and the panel says so.

10. What we would do next
   Persist AgentKit nonces and usage in the shared storage interface, scope delegation by amount cap and expiry, run the Claude proposer against a live key and a few real campaigns (not done yet), cover the reasons
   with the signature, and move the two-party state into the escrow event flow.
```
