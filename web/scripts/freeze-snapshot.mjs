#!/usr/bin/env node
// Daily freeze for the Chainlink CRE workflow:
//   1. POST /api/snapshots/refresh   (refresh today's platform view counts; needs CRON_SECRET)
//   2. GET  /api/snapshots/daily     (frozen snapshot of the last COMPLETED UTC day) and save it
// Usage: BACKEND_URL=http://localhost:3000 CRON_SECRET=... node scripts/freeze-snapshot.mjs [--day YYYY-MM-DD] [--out file.json] [--no-refresh]
// Run it from a daily cron BEFORE the CRE schedule (default 00:30 UTC), e.g. 00:10 UTC.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const base = (process.env.BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!args.includes("--no-refresh")) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { console.error("CRON_SECRET is required (or pass --no-refresh)"); process.exit(1); }
  const r = await fetch(`${base}/api/snapshots/refresh`, { method: "POST", headers: { "x-cron-secret": secret } });
  if (!r.ok) { console.error(`refresh failed: HTTP ${r.status} ${await r.text()}`); process.exit(1); }
  console.log("refresh:", JSON.stringify(await r.json()));
}

const day = flag("day");
const res = await fetch(`${base}/api/snapshots/daily${day ? `?day=${day}` : ""}`);
if (!res.ok) { console.error(`daily snapshot failed: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
const snap = await res.json();
console.log(`frozen day=${snap.day} rows=${snap.rows.length} hash=${snap.hash}`);
const out = flag("out");
if (out) writeFileSync(out, JSON.stringify(snap, null, 2));
