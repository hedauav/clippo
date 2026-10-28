# Deploying the Clippo web app to Vercel (public TEST deployment)

Variables: see [DEPLOY_ENV.md](DEPLOY_ENV.md) (includes the **do not set on Vercel** list). Everything runs from `web/`. Nothing below is automated: you log in and click.

## What is serverless-specific (already handled in code)

| Concern | Handling |
|---|---|
| Local-disk uploads | `STORAGE_PROVIDER=blob` uses a **private** Vercel Blob store. Reads stream through `/api/uploads/[id]/file` (auth + Range + `?download=1` kept). Local disk stays the default in dev and is refused on Vercel. |
| 4.5 MB function body limit | Clips above ~4 MB upload browser -> Blob with a short-lived token (`/api/uploads/direct`), then `/api/uploads/complete` verifies size + real mp4/webm/mov bytes. Limit: `SOURCE_MAX_BYTES`. |
| AI video polling | State lives in Postgres; the page polls `GET /api/ai-video/jobs/:id`, and `/api/cron/video-jobs` (every 5 min) finishes jobs nobody is watching. |
| In-memory LLM queue/throttle/cache | Per instance only (see DEPLOY_ENV.md). Postgres rate limiter caps LLM, upload, nonce/session, on-ramp and World ID routes per IP (or user). |
| Long-lived indexer | `/api/cron/chain-sync` every 5 min (idempotent, cursor in DB). Fund/claim also index their own receipt immediately. |
| Daily snapshot | `/api/cron/snapshots-freeze` 00:10 UTC (refresh + freeze of the last completed UTC day; the feed is `GET /api/snapshots/daily`), `/api/cron/snapshots-refresh` 06/12/18 UTC. View-anomaly/fraud flags and deleted-clip checks run inside the refresh. `/api/cron/status-ladder` is a no-op unless `FEATURE_STATUS_LADDER` is on. |
| Test doubles | `instrumentation.ts` throws if `CLIPPO_E2E_DOUBLES=1` under `NODE_ENV=production` or on Vercel; `setOverride` also throws in production. Covered by tests. |
| Dev wallet bypass | `{wallet, role}` sign-in and the `x-wallet` header are ignored when `NODE_ENV=production` (tests in `src/lib/deploy-safety.test.ts`; `smoke-deploy.mjs` re-checks live). |
| Sessions | `SESSION_SECRET` (>= 32 chars) is mandatory in production; cookie is `HttpOnly; SameSite=Lax; Secure` on https. |
| SIWE domain | Taken from the request `Host`, so production, custom domain and every preview URL work. `SIWE_DOMAIN` overrides it (rarely needed; do not set on Preview). |
| PGlite | devDependency used only by tests/`db:local`; not in the runtime path. |

**Cron plan limits:** the 5-minute crons require a Vercel **Pro** plan (Hobby allows only one run per day per cron and rejects the deployment otherwise). On Hobby, change `chain-sync` and `video-jobs` to daily in `vercel.json`; money flows still index immediately via their receipts, admins can run `POST /api/chain/sync`.

## One-time steps (you)

1. **Tools and login**
   ```
   npm i -g vercel
   vercel login            # you authenticate (browser/email)
   ```
2. **Neon database**: create a Neon project (region near Vercel `bom1`, e.g. AWS ap-south-1 if offered, else Singapore). Create a branch `preview` for Preview deploys if you want isolation. Copy the **pooled** string (host contains `-pooler`) as `DATABASE_URL` (+ `?sslmode=require&pgbouncer=true&connection_limit=5&connect_timeout=15`) and the **direct** string as `DIRECT_URL`.
3. **Migrate (separate step, not at build)**, from `web/`:
   ```
   export DIRECT_URL='postgresql://...direct...'      # PowerShell: $env:DIRECT_URL='...'
   npm run db:migrate:direct -- --status               # optional: see pending migrations
   npm run db:migrate:direct                           # = prisma migrate deploy over the direct URL
   ```
   Re-run after every deploy that adds a migration (new migrations: `20261028020000_rate_limit` is required by the rate limiter).
4. **Link the project** (root directory is `web`):
   ```
   cd web
   vercel link             # choose team, create project "clippo-test" (or your name); if asked for Root Directory answer: web (or ./ when you run it from web/ and the repo root is web)
   ```
   If the git repo root is the parent folder, set Settings > General > Root Directory = `web`.
5. **Blob store**: Dashboard > Storage > Create > Blob > **Private** > connect to the project for Production and Preview. This injects `BLOB_STORE_ID` (OIDC auth) or a token.
6. **Environment variables**: dashboard (Settings > Environment Variables) or CLI, one per variable in DEPLOY_ENV.md:
   ```
   vercel env add SESSION_SECRET production        # paste when prompted; repeat with 'preview'
   vercel env add CRON_SECRET production
   vercel env add DATABASE_URL production
   ...
   vercel env ls
   ```
   Mark secrets as **Sensitive**. Set `NEXT_PUBLIC_TEST_DEPLOY=1`, `AGENT_PASS_DEMO=1`, `STORAGE_PROVIDER=blob`, `WORLD_ID_ENVIRONMENT=staging`. Double-check nothing from the do-not-set list is present.
7. **First preview deploy**
   ```
   vercel                   # preview deployment (prints the URL)
   node scripts/smoke-deploy.mjs https://<preview-url> [--bypass <Protection Bypass secret>]
   ```
   The build runs `npm ci` (postinstall `prisma generate`) then `npm run build` (`prisma generate && next build`). Migrations are NOT run at build.
8. **Promote** when the smoke test and a manual sign-in pass: `vercel --prod`, or Dashboard > Deployments > Promote (or `vercel promote <url>`).
9. **Deployment Protection (decide)**: Settings > Deployment Protection.
   - *Team-only* (Vercel Authentication): safest, but teammates need Vercel seats, World/Transak/Instagram callbacks and CRE cannot reach it, and Cron still works (Vercel bypasses protection for its own cron calls).
   - *Public with noindex* (what this build is designed for): set Vercel Authentication to **Only Preview Deployments** or Disabled for Production. Add a Protection Bypass secret if you want to smoke-test protected previews.
   Recommended for testers: public production URL, protected previews.
10. **After the URL is known** (use the stable production domain, e.g. `https://clippo-test.vercel.app`):
    - **World Developer Portal**: add the origin/redirect for the staging app; keep `WORLD_ID_ENVIRONMENT=staging`.
    - **Transak** staging dashboard: webhook `https://<host>/api/onramp/webhook`, referrer domain = host (or `TRANSAK_REFERRER_DOMAIN`), redirect URL.
    - **Instagram/Meta app**: Valid OAuth Redirect URI `https://<host>/api/channels/instagram/oauth/callback`, same value in `INSTAGRAM_REDIRECT_URI`, then redeploy.
    - **SIWE**: nothing to do (Host based). Only set `SIWE_DOMAIN` for a custom domain behind a rewriting proxy.
    - **Chainlink CRE**: point the workflow at `https://<host>/api/snapshots/daily`; this needs a publicly reachable deployment (not team-protected).
    - Wallets: testers need Arc testnet USDC from `https://faucet.circle.com`.

## Post-deploy smoke test

```
node scripts/smoke-deploy.mjs https://<url>
```
Checks: `/api/health` (db + chain + readiness booleans), `/api/chain/config`, `/api/auth/nonce` (domain equals host), `/wire`, security headers (X-Frame-Options, Referrer-Policy, nosniff, CSP report-only), noindex + banner + robots on a test deploy, all `/api/cron/*` reject missing/wrong secret, `POST /api/snapshots/refresh` rejects anonymous, dev wallet bypass refused. Exit code 1 on any failure.

Manual checklist: sign in with a wallet (SIWE) as campaigner and as creator; upload a small and a >5 MB clip, play it with seeking, download it; create + fund a campaign (indexer picks up within 5 min or immediately); submit a clip (LLM verdict); `GET /api/cron/chain-sync` with `Authorization: Bearer $CRON_SECRET` returns 200; Vercel > Logs > Cron shows runs.

Verify crons: Dashboard > Settings > Cron Jobs (they exist only on Production deployments). Trigger manually:
```
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/snapshots-freeze
```

## Operating notes

- Tester bug reports: `GET /api/health`, Vercel Logs (filter by path), and the TESTNET banner mean testers know funds are fake.
- Rate limits (per IP per window): nonce 60/10 min, session 30/10 min, uploads 20/h, AI video 5/h, wizard/assistant/verifier/deal/split-propose 20-60/h. Disable with `RATE_LIMIT=0` or tune in the route files.
- JSON bodies over 1 MB are refused (`413 BODY_TOO_LARGE`).
- Functions run in `bom1` (Mumbai); change `regions` in `web/vercel.json` if the Neon region is elsewhere (keep DB and functions close).

## Rollback

- Code: Dashboard > Deployments > previous good deployment > **Promote to Production**, or `vercel rollback` (or `vercel rollback <deployment-url>`).
- Database: migrations are forward-only. Rollback = promote the previous deployment (new tables are additive and ignored by old code); for data loss use Neon **point-in-time restore / branch** (restore a branch, then switch `DATABASE_URL`).
- Emergency stop: remove `ESCROW_ADDRESS` (money endpoints answer 503), or set `CRON_SECRET` to a new value to stop crons being accepted, or pause the project in Vercel.
- Leaked secret: rotate it in the provider, `vercel env rm NAME production`, `vercel env add`, redeploy; rotating `SESSION_SECRET` signs everybody out.
