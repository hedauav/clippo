# Submission checklist

| Item | Value / status |
| --- | --- |
| Repo link | `<REPO_URL>` (note: `contracts/` and `web/` contain their own `.git` folders; decide on one repo or submodules before submitting) |
| Arc Studio project URL | `<ARC_STUDIO_PROJECT_URL>` (required; show Studio in the video) |
| Deployed escrow (Arc testnet explorer) | `<ARCSCAN_ESCROW_URL>` |
| Demo video (max 5 min) | `<VIDEO_URL>`, script in `docs/DEMO_SCRIPT.md` |
| Architecture diagram | `docs/ARCHITECTURE.md` (export the Mermaid to PNG for the form) |
| Live app URL (optional) | `<APP_URL>` |

## Per track

- [ ] Chainlink CRE: successful `cre workflow simulate` output captured (screenshot or log); workflow link in `cre/`; id gap in `ARCHITECTURE.md` resolved.
- [ ] World Agent Pass: official integration, full journey with denied path, backend validation shown, integration debrief filled from `docs/TRACKS.md`.
- [ ] World IDKit: the IDKit widget and v4 backend verify are wired; still to do: run once with real `WORLD_ID_*` and capture the failure paths (cancel, expire, reuse).
- [ ] Arc: built in Arc Studio, Studio URL shown, contracts deployed to Arc testnet, working frontend + backend, campaign shown funding to claim.

## Before submitting

- [ ] Re-run `forge test`, `npm test`, `npm run lint`, `npm run typecheck` (web and cre).
- [ ] No secrets committed (`web/.env`, `web/.env.local`, `cre/.env` excluded).
- [ ] README status table matches reality (updated after the UI/demo pass; re-check after any live run).
- [ ] Demo data: `node scripts/seed-demo.mjs --reset` ran clean; no `[SEED]` rows in the production DB.
- [ ] Responsive: `npm run check:overflow` passes; device screenshots reviewed (`web/scripts/shoot-senior.mjs`, output in `design/shots/senior`).
- [ ] Video states what was not run live (CRE broadcast, live World ID / AgentBook, platform APIs if keys are missing).
- [ ] `NEXT_PUBLIC_DEMO` is unset in the recorded build.
