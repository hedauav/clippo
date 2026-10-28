import { chainConfig } from "@/lib/chain/config";
import { syncChain } from "@/lib/chain/indexer";
import { ok, route } from "@/lib/http";
import { requireCron } from "@/lib/modules/cron";

/** Vercel Cron: index new escrow events (no long-lived indexer process on serverless). Idempotent; skipped when no escrow is configured. */
export const GET = route(async (req: Request) => {
  requireCron(req);
  if (!chainConfig().enabled) return ok({ skipped: true, reason: "ESCROW_ADDRESS is not configured" });
  return ok(await syncChain({ maxBlocks: 20_000 }));
});
