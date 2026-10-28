import { z } from "zod";
import { syncChain } from "@/lib/chain/indexer";
import { ok, route } from "@/lib/http";
import { requireAdminOrCron } from "@/lib/modules/cron";

const body = z.object({ maxBlocks: z.number().int().positive().max(1_000_000).optional() }).default({});

/** Index new escrow events into the database. Admin session or `x-cron-secret: $CRON_SECRET`. Idempotent. */
export const POST = route(async (req: Request) => {
  await requireAdminOrCron(req);
  const raw = await req.text();
  const { maxBlocks } = body.parse(raw ? JSON.parse(raw) : {});
  return ok(await syncChain({ maxBlocks }));
});
