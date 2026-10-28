# World, Best Use of IDKit (sign-up verification)

Scope: creator sign-up proof of human. The split/attest paths belong to the Agent Pass track (`docs/TRACKS.md`).

## Research notes (docs.world.org, read 2026-10-28)

- IDKit 4.x flow: backend signs an RP request (`signRequest`, never client side) giving `sig, nonce, created_at, expires_at`; client builds `rp_context {rp_id, nonce, created_at, expires_at, signature}` and renders `IDKitRequestWidget` with `app_id, action, environment, preset, allow_legacy_proofs`; backend forwards the IDKit result unmodified to `POST https://developer.world.org/api/v4/verify/{rp_id}` and accepts only `success === true` with matching `environment`.
- Environments for the request/verify body: `production` (default), `staging`, `sandbox`. The integrate page mentions the staging simulator (simulator.worldcoin.org); the Sandbox page says use `environment: sandbox` with the World ID (Sandbox) app (access requested in the Developer Portal; TestFlight / Play testing) and still post to the production verify endpoint.
- Nullifier: unique per (user, app/RP, action). Store it, reject reuse for the same action (docs suggest `NUMERIC(78,0)`). Docs recommend `handleVerify` so a backend refusal puts the widget in error (`failed_by_host_app`).
- Presets: `orbLegacy`, `proofOfHuman` documented; we use `orbLegacy` / `deviceLegacy` from the installed package with `allow_legacy_proofs`.
- Error codes (28) documented at /world-id/idkit/error-codes, incl. `user_rejected`, `max_verifications_reached`, `nullifier_replayed`, `rp_signature_expired`, `timeout`, `connection_failed`, `failed_by_host_app`.
- On-chain: v4 `WorldIDVerifier.verify(nullifier, action, rpId, nonce, signalHash, expiresAtMin, issuerSchemaId, credentialGenesisIssuedAtMin, uint256[5] proof)`; action = `keccak256(action) >> 8`. World Chain prod `0x00000000009E00F9FE82CfeeBB4556686da094d7`, staging `0x703a6316c975DEabF30b637c155edD53e24657DB`, **Arc prod (WorldIDSatellite) `0x304E14e4dC0508C0927e3b307a2C18422C07E394`**. Store nullifier in a mapping only after verify succeeds.
- Prize page: **NOT FOUND.** `ethglobal.com/events/mumbai2026/prizes/world` returns 404 and search does not index a Mumbai World page. The nearest analogue (Cannes 2026 "Best use of World ID 4.0") requires World ID to be a real constraint and proof validation in a web backend **or** smart contract; no on-chain deployment required; judging and demo requirements not specified. PRD section 6.2 lists: official integration, complete journey with denied path, backend validation, short debrief. Re-check the real Mumbai page before submission.

## Requirement checklist

| Requirement | Source | Status |
| --- | --- | --- |
| Official IDKit 4.x integration (`@worldcoin/idkit` ^4.6) | PRD 6.2, docs | Done: `IDKitSheet.tsx` uses `IDKitRequestWidget` |
| RP context signed on the backend, key server-only | docs integrate | Done: `/api/worldid/rp-signature`, `createRpContext` |
| Proof validated server-side via `/api/v4/verify/{rp_id}`, `success` + environment checked | docs, Cannes analogue | Done in code (mocked fetch in tests); not run against a live portal |
| Result forwarded unmodified; action/environment mismatch refused | docs verify API | Done: `RealWorldId`, tests |
| Account marked verified only after backend validation | PRD 6.2 | Done: `completeSignup` |
| One person one account: nullifier unique | PRD 6.2, docs nullifier | Done: `User.worldIdNullifier @unique`, normalised, P2002 race handled, 409 `ALREADY_USED`; swap on a verified account refused (`ACCOUNT_ALREADY_VERIFIED`) |
| World ID is a real constraint (gates features) | Cannes analogue | Done: 403 `NOT_VERIFIED` on channel create/verify, deals, submissions, claim |
| Failure paths: cancelled, expired, already used, not configured leave action undone | PRD 6.2 | Done in UI text + backend; real widget error mapping in `IDKitSheet` |
| On-chain verification | docs (optional per analogue) | Optional path built (`lib/worldid/onchain.ts`, env `WORLD_ID_ONCHAIN_VERIFIER`, `WORLD_ID_ONCHAIN_RPC_URL`); arg mapping unit tested; ABI types and rp id numeric form unverified on a live contract |
| Verified-human badge | PRD | Done: `VerifiedMark` in Join and Account |
| Real run with staging/sandbox app and screenshots | judges | **Not done: needs credentials** |
| Short integration debrief | PRD 6.2 | Template in `docs/TRACKS.md`; fill after real run |
| Use `handleVerify` so backend refusal shows inside the widget | docs react | Not adopted; we verify after `onSuccess` and show our own message |
