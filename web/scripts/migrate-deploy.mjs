#!/usr/bin/env node
// Apply Prisma migrations to Neon over the DIRECT (non-pooled) connection. Run by a human, never at build time:
//   DIRECT_URL="postgresql://...neon.tech/db?sslmode=require" node scripts/migrate-deploy.mjs
// Why: Neon's pooler (pgbouncer, host contains "-pooler") cannot take Prisma's advisory locks / DDL. Runtime uses DATABASE_URL (pooled).
// Falls back to DATABASE_URL with "-pooler" stripped from the host. Pass --status to only print migration status.
import { spawnSync } from "node:child_process";

let url = process.env.DIRECT_URL?.trim();
if (!url && process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.hostname = u.hostname.replace("-pooler", "");
  u.searchParams.delete("pgbouncer");
  u.searchParams.delete("connection_limit");
  url = u.toString();
  console.warn("DIRECT_URL not set: derived a direct URL from DATABASE_URL by dropping the -pooler host suffix.");
}
if (!url) {
  console.error("Set DIRECT_URL (Neon non-pooled connection string).");
  process.exit(1);
}
const host = new URL(url).hostname;
console.log(`Target database host: ${host}${host.includes("-pooler") ? "  <-- WARNING: pooled host" : ""}`);
const cmd = process.argv.includes("--status") ? "status" : "deploy";
const r = spawnSync("npx", ["prisma", "migrate", cmd], { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: url } });
process.exit(r.status ?? 1);
