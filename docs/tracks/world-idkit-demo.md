# World IDKit demo clicks (about 90 seconds)

Prereq: `.env.local` has `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY`, `WORLD_ID_ACTION=clippo-creator-signup`, `WORLD_ID_ENVIRONMENT=staging` (or `sandbox`), and `NEXT_PUBLIC_*` unset (not demo mode). Two wallets in the browser, one phone with the staging simulator or the World ID Sandbox app.

1. Wallet A: open /join, pick "I clip", connect. Show step 2 greyed out. Optionally show `POST /api/channels` returning 403 `NOT_VERIFIED`.
2. Press "Verify with World ID". Show the IDKit QR. Press Cancel: "You cancelled the check. Nothing was changed." Account still unverified (`/api/auth/me`).
3. Press again, approve in the simulator/World app. Badge "Verified with World ID" appears, step 2 unlocks. Show the backend call: `/api/worldid/verify` 200, response `mode: real`.
4. Prove a channel, submit a clip: allowed.
5. Wallet B (new account): /join, verify with the same World ID. Show "This World ID is already linked to another Clippo account", account B unverified, channel proof refused (403).
6. Optional: expired (let the QR time out) shows "The check timed out"; unset `WORLD_ID_APP_ID` shows the "not configured" sheet.
7. Close with the debrief and, if enabled, the on-chain check (`WORLD_ID_ONCHAIN_VERIFIER`).

Automated, credential-free: `npm run e2e:world` (dev server + DB running) checks gating 403s and the not-configured sheet, and that backend refusals leave the account unverified. It cannot scan a QR: steps 3 and 5 need a real app.

Tests: `npx vitest run src/lib/worldid` (explicit `FakeWorldId` double and a stubbed `fetch`).
