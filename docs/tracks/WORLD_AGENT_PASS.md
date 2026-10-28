# World, Agent Pass: research and requirement checklist

Prize: $5,000 across three places (ETHGlobal Mumbai). Researched 2026-10-28.

## What "Agent Pass" is today (researched)

World does not publish a product called "Agent Pass" in its docs. The product that matches the prize description is **World AgentKit** (beta, built on x402), plus a sibling **Human-in-the-loop** kit. Treat "Agent Pass" as the prize name for AgentKit.

| Topic | Finding | Source |
| --- | --- | --- |
| Purpose | AgentKit lets a service tell human-backed agents apart from bots and scripts. | https://docs.world.org/agents/agent-kit |
| Agent to human link | A human registers the agent's wallet address in **AgentBook**, an on-chain registry on World Chain (`eip155:480`, contract `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`). Registration is `npx @worldcoin/agentkit-cli register <agent-address>`; the World App verification flow prompts the person and the CLI submits the transaction through a hosted relay. `status <address>` checks it. | agent-kit docs; https://docs.world.org/agents/agent-kit/sdk-reference.md |
| Delegation | Not a separate feature. Registration in AgentBook is the delegation. There is no scoped or revocable delegation API in the docs. | agent-kit docs |
| Agent proves itself | The agent signs a SIWE (EIP-4361 / CAIP-122) payload; the server checks it and calls `lookupHuman(address)`, which returns an anonymous human id or `null`. Header name `agentkit` (base64 JSON). | sdk-reference |
| SDK | `@worldcoin/agentkit` (client `createAgentkitClient`, server `createAgentkitHooks`, `declareAgentkitExtension`, `InMemoryAgentKitStorage`) re-exporting `@worldcoin/agentkit-core` (`createAgentBookVerifier`, `parseAgentkitHeader`, `validateAgentkitMessage`, `verifyAgentkitSignature`, `formatSIWEMessage`, `AgentkitPayloadSchema`). CLI: `@worldcoin/agentkit-cli`. Installed here: `@worldcoin/agentkit@0.2.1` (read from node_modules typings). | npm; sdk-reference |
| Access modes and limits | `free`, `free-trial` (default 3 uses, per human per endpoint), `discount`. Usage counters are per endpoint and per human id, so several agents of one human share the allowance. No other rate limits are documented. | agent-kit docs |
| Replay protection | Optional storage hooks `hasUsedNonce` / `recordNonce`; production needs durable storage. | agent-kit docs |
| Human-in-the-loop | Separate kit: an agent pauses and a verified human approves via a World ID proof bound to an action string. Packages `@worldcoin/human-in-the-loop` (server, Workflow SDK + AI SDK v6) and `@worldcoin/human-in-the-loop-react`. Server must re-verify the proof at `POST https://developer.world.org/api/v4/verify/{rp_id}` with `environment: production`, bind the action to the operation, and consume the nullifier once in durable storage. | https://docs.world.org/agents/human-in-the-loop/integrate.md |
| auth.world.org / OIDC step-up | Nothing found in docs.world.org for agents. Not used. | docs.world.org/llms.txt search |
| Fake or mock identities | The docs describe no fake-identity fixture. They note that staging and sandbox environments accept test proofs, which is why production must be pinned on the server. The PRD says Agent Pass proofs use fake identities (demo only); that statement is **not confirmed by the public docs**. | human-in-the-loop docs; PRD 6.2 |
| What the prize judges | **Not retrievable.** `ethglobal.com/events/mumbai2026/prizes` returned 404 and search found no Mumbai page. The closest published text is the Cannes 2026 World track "Best use of Agent Kit": apps that use AgentKit where World ID improves safety, fairness or trust; submissions must integrate AgentKit to meaningfully distinguish human-backed agents from bots; World ID or MiniKit alone do not qualify. The PRD adds: official integration, complete journey with a denied path, backend validation, short integration debrief. | https://ethglobal.com/events/cannes2026/prizes; PRD 6.2 |

## Requirement checklist

Status key: DONE (built and tested), PARTLY, TODO (needs your credentials or a real device), UNVERIFIED (could not confirm from public sources).

| # | Requirement | Source | Status |
| --- | --- | --- | --- |
| 1 | Use AgentKit, not only World ID, to distinguish a human-backed agent from a bot | Cannes track text (Mumbai page unreadable) | DONE in code: the proposer is an AgentKit agent wallet; the backend verifies its SIWE payload and an AgentBook lookup (`lib/agentpass/`). TODO: register the real wallet in AgentBook (needs World App + a verified human). |
| 2 | Agent registered or delegated by the campaigner | Task brief | PARTLY: `POST /api/campaigns/:id/agent` binds the AgentBook-registered wallet to one campaign (revocable with DELETE). AgentBook itself has no scoped delegation, and it cannot prove that the registering human is the campaigner (human ids are anonymous). |
| 3 | AI proposes the split; proposals signed and attributed | PRD 6.2 | DONE: signed AgentKit payload bound to the split hash; stored and audited. The proposer is Claude (`claude-sonnet-5-5` via `lib/ai/llm.ts`), advisory only; the old proportional planner remains as the explicit `mode: "deterministic"` option and as the checked fallback. See "Claude-backed proposer" below. |
| 4 | Approver(s) complete a fresh World ID check; backend validates before escrow releases | PRD 6.2 | DONE: proof bound to `split:<campaign>:<hash>`, verified at the Developer Portal v4, consumed once. Needs real World ID app credentials to run for real; test doubles cover it in tests. |
| 5 | Guardrail: agents never release payouts alone; high-value needs a fresh unique-human confirmation | PRD 4.8 | DONE: no agent code path writes payouts, approvals, attestations or proofs (guardrail tests); payouts only come from the on-chain event indexer; high-value campaign approval already needs `/attest`. |
| 6 | Failure path: cancelled | PRD 6.2 | DONE (backend 403 `WORLD_ID_DENIED`; widget cancel reported to the audit log) |
| 7 | Failure path: expired | PRD 6.2 | DONE (proof expired; and the agent proposal's own 30 minute expiry: 410 `PROPOSAL_EXPIRED`) |
| 8 | Failure path: repeated or replayed proof | PRD 6.2 | DONE (409 `PROOF_REUSED`, unique proof hash). Real-mode replay rule at World's side: UNVERIFIED. |
| 9 | Failure path: wrong approver | Task brief | DONE (403 `WRONG_APPROVER` / `FORBIDDEN`) |
| 10 | Failure path: split changed after the agent proposed (hash mismatch) | Task brief | DONE (409 `SPLIT_CHANGED`) |
| 11 | Failure path: already released | Task brief | DONE (409 `ALREADY_RELEASED`) |
| 12 | Each failure leaves the action undone and is logged, visible in the UI | Task brief | DONE: `AgentAudit` table, "Agent Pass activity" panel in the campaign desk and the bench |
| 13 | Agent Pass activity panel (what it proposed, who approved, proof status) | Task brief | DONE (`AgentPassPanel`, desk per campaign, bench across campaigns) |
| 14 | Short integration debrief | PRD 6.2 | DONE as a draft: `docs/tracks/agent-pass-debrief.md`. Fill in the setup time and clarity score after you register the agent. |
| 15 | Demo shows the failure paths | PRD 6.2 | DONE as a script: `docs/tracks/agent-pass-demo.md`. Needs a recorded run. |
| 16 | Agent Pass proofs use fake identities, demo only | PRD 6.2 | PARTLY: `AGENT_PASS_DEMO=1` uses a locally derived wallet and a fake human, labelled "demo" everywhere. Whether World provides official fake identities for this prize: UNVERIFIED. |
| 17 | Rate limits | Task brief | Documented only as the AgentKit free-trial counters; Clippo does not use x402 payment gating, so none apply. No Developer Portal rate limit is documented. |
| 18 | Mumbai prize page wording and judging criteria | Task brief | UNVERIFIED (page unreachable). Re-read it before submitting. |

## Claude-backed proposer (PRD 4.4, 4.8, 6)

`POST /api/campaigns/:id/split/propose` takes an optional body `{ "mode": "llm" | "deterministic" }` (default `llm`).

| Topic | Behaviour |
| --- | --- |
| Inputs to the model | Campaign story, pool rules (net pool in micro-USDC, share basis VIEWS or APPROVED_CLIPS, optional `perCreatorCapUsdc` from the story), and per eligible creator: approved clip count, views (max snapshot), verdict confidence and flags, clips with the disclosure present, message points hit, appeals (overturned, upheld, pending), human-decided clips. |
| Untrusted text | Titles, verdict notes and transcript excerpts sit between `<<<UNTRUSTED_CLIP_DATA_<nonce>` ... `UNTRUSTED_CLIP_DATA_<nonce>>>>` lines, sanitized with the verifier's `sanitizeUntrusted`; the system prompt carries the anti-injection rules (same pattern as `lib/ai/verifier.ts`). `detectInjection` also adds an `injection_suspected` flag. |
| Output | Strict JSON `{splits:[{creator,amountMicroUsdc,reason}], rationale, confidence, flags}`, parsed with zod. |
| Enforced in code (`enforceConstraints`, never trusting the model) | integer micro-USDC; creators must be eligible (approved, live clip); no negatives, no duplicates (case-insensitive); total <= net pool; each amount <= per-creator cap when configured; confidence in 0..1; amounts must round-trip exactly to units. Zero amounts are dropped (flag). |
| Rounding dust | If the model leaves fewer micro-USDC than there are creators unallocated, the dust goes to the largest share (ties: lowest wallet) unless the cap forbids it. Larger gaps stay unallocated and are flagged `pool_partly_unallocated`. |
| Fallback | Any violation, malformed JSON, provider error or timeout (45 s) returns the deterministic split (also cap-clamped) and writes an audit row `REFUSED / AI_REJECTED` with the code (`CONSTRAINT_VIOLATION`, `MALFORMED_JSON`, `LLM_ERROR`, `LLM_TIMEOUT`) and the violations; the proposal is stored with `meta.fallback`. |
| Stored | Per-creator `reason` inside `AgentProposal.splits[]`, plus `rationale` and new `meta` (source, model, confidence, flags, fallback). Signing and attribution are unchanged: the AgentKit payload is bound to the split hash. Reasons and rationale are NOT covered by the signature (the hash binds the amounts only). |
| Not configured | Without `ANTHROPIC_API_KEY` the `llm` mode returns 503 `NOT_CONFIGURED`; there is no mock in production. `deterministic` mode works without a key and is labelled "Propose without AI" in the desk. |
| UI | `AgentPassPanel` (`ProposalReasons`) and the admin review in `AdminSplits` show source, model confidence, flags, any fallback reason and each creator's reason. |
| Guardrail | `lib/agentpass/llm-proposer.ts` is pure (LLM client injected, no db, chain, config, fetch, proofs, payout words); `guardrail.test.ts` covers it, and the existing check that agent code only writes `agentIdentity`, `agentProposal`, `agentAudit` still applies to the whole folder. Reasons are model-written text: approvers, not the model, decide. |
| Tests | `lib/agentpass/llm-proposer.test.ts` (LLM double: valid, over-pool, non-eligible, duplicates, negative/fractional, cap, malformed JSON, injection, error, timeout, dust) and DB tests in `agentpass.integration.test.ts` (stored reasons, audited fallback, 503 NOT_CONFIGURED). A live call to Claude was not run. |
