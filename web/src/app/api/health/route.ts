import { NextResponse } from "next/server";
import { chainConfig } from "@/lib/chain/config";
import { publicClient } from "@/lib/chain/clients";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { storageMode } from "@/lib/storage";
import { resolveProvider } from "@/lib/ai/llm";

const has = (n: string) => !!process.env[n]?.trim();
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** Liveness + readiness for the deployment. Booleans only: no secrets, no values. 200 when the database answers, 503 otherwise. */
export const GET = route(async () => {
  const t0 = Date.now();
  let dbOk = false;
  try {
    await within(db.$queryRaw`SELECT 1`, 4000);
    dbOk = true;
  } catch {}
  let chainOk: boolean | null = null;
  let chainId: number | null = null;
  if (chainConfig().enabled) {
    try {
      await within(publicClient().getBlockNumber({ cacheTime: 0 }), 4000);
      chainOk = true;
    } catch {
      chainOk = false;
    }
    chainId = chainConfig().chainId;
  }
  let llm = false;
  try {
    resolveProvider();
    llm = true;
  } catch {}
  const prod = process.env.NODE_ENV === "production";
  const config = {
    database: has("DATABASE_URL"),
    sessionSecret: (process.env.SESSION_SECRET?.length ?? 0) >= 32,
    cronSecret: (process.env.CRON_SECRET?.length ?? 0) >= 16,
    adminWallets: has("ADMIN_WALLETS"),
    escrow: chainConfig().enabled,
    llm,
    worldId: has("WORLD_ID_APP_ID") && has("WORLD_ID_RP_ID") && has("WORLD_ID_SIGNING_KEY"),
    youtube: has("YOUTUBE_API_KEY"),
    storage: storageMode(),
    storageReady: storageMode() === "blob" ? has("BLOB_READ_WRITE_TOKEN") || has("BLOB_STORE_ID") : !process.env.VERCEL,
    testDeploy: process.env.NEXT_PUBLIC_TEST_DEPLOY === "1",
    devAuthBypassDisabled: prod,
    e2eDoublesOff: process.env.CLIPPO_E2E_DOUBLES !== "1",
    dangerousKeysAbsent: !["DEPLOYER_PRIVATE_KEY", "ADMIN_PRIVATE_KEY", "CRE_ETH_PRIVATE_KEY"].some(has),
  };
  const ready = dbOk && config.sessionSecret && config.cronSecret && config.escrow && config.storageReady && config.dangerousKeysAbsent;
  return NextResponse.json(
    { status: dbOk ? "ok" : "degraded", ready, db: dbOk, chain: chainOk, chainId, config, ms: Date.now() - t0, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV },
    { status: dbOk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
});
