# World ID setup check (2026-10-28)

No secret values appear here; only names, lengths and pass/fail.

## Result summary

| Check | Result |
|---|---|
| doctor: WORLD_ID_APP_ID / RP_ID / SIGNING_KEY / ENVIRONMENT | OK (set) |
| doctor: RP signing key | OK, can sign an RP request |
| doctor: Developer Portal rp_id | OK, portal answered 400 on an empty proof (rp_id exists) |
| Signing key format | OK: `0x` + 64 hex chars (66 total), no quotes, whitespace or PEM. The earlier "non-hex" error was from before the values were pasted. |
| WORLD_ID_ENVIRONMENT | `staging` |
| /api/worldid/rp-signature (real key, SIWE session) | PASS for default, `clippo-approve-split`, `clippo-approve-campaign` |
| Portal: app exists (precheck) | PASS (app resolves; portal name "Clipoo") |
| Portal: each action exists | NOT VERIFIABLE remotely (see below) |
| `npm run e2e:world` | PASS against a production build; dev server hangs (see below) |
| vitest `src/lib/worldid` | 2 files, 21 tests pass |
| tsc / eslint | clean |

## rp-signature shape
Keys: app_id, rp_id, action, environment, nonce, created_at, expires_at, signature. app_id starts `app_`, rp_id starts `rp_`, action equals the requested action, environment `staging`, signature is 0x-hex of length 132 (65-byte ECDSA), nonce is 0x + 64 hex, TTL 300s. Matches the IDKit docs.

## Portal action check
- `POST developer.world.org/api/v1/precheck/{app_id}` returns 200 for the app, but it also returns 200 for a deliberately nonexistent action, so it cannot prove an action exists.
- `POST /api/v4/verify/{rp_id}` with a well-formed zero proof fails with `invalid_merkle_root` identically for all three actions and a nonexistent one. Proof checks run before the action lookup, so it cannot tell actions apart either.
- `staging-developer.worldcoin.org` answers 404 for the app id (apps live on developer.world.org).
- Note: precheck reports `is_staging=false` while `WORLD_ID_ENVIRONMENT=staging`. Confirm in the Developer Portal that the app/actions are set for the Simulator (staging) environment.
- The three action names can only be confirmed by a real simulator proof.

## Code changes
- New `web/src/lib/worldid/signing-key.ts` (`normalizeSigningKey`): accepts bare or 0x hex (any case), trims whitespace, strips one layer of quotes and an accidental `WORLD_ID_SIGNING_KEY=` prefix, returns `0x` + lowercase. Errors name the problem (empty, PEM, base64, non-hex, wrong length, inner whitespace, all zeros) and never echo the value.
- `worldIdConfig()` uses it; a bad key gives a 503 NOT_CONFIGURED with that message.
- `scripts/doctor.mjs` applies the same normalisation and reports length-only diagnostics.
- New `signing-key.test.ts` (15 tests).

## Known issue
`npm run dev` (Next 16 dev) keeps re-compiling and reloading pages in headless Chromium, so `e2e:world` times out waiting for `networkidle` on `/join`. The same script passes against `next build` + `next start`. Not caused by World ID changes.

## What you must do next (manual)
1. Open https://simulator.worldcoin.org, create or use a simulator identity, and keep `WORLD_ID_ENVIRONMENT=staging`.
2. Run `npm run build && npm start` (or `npm run dev`), sign in with a wallet, open Account, press "Verify with World ID".
3. Scan the QR code shown with the simulator and approve.
4. Repeat for an approval flow (split and campaign) to confirm `clippo-approve-split` and `clippo-approve-campaign` exist; "action not found" or similar from the portal means a name or environment mismatch.
5. Check the creator-signup limit of 1: a second verification with the same simulator identity should be refused as already used.
