import { z } from "zod";
import { resolveFlag } from "@/lib/antifraud/flags";
import { requireUser } from "@/lib/auth";
import type { Ctx } from "@/lib/domain";
import { ok, readJson, route } from "@/lib/http";

const body = z.object({ action: z.enum(["DISMISS", "CONFIRM"]) });

/**
 * Resolve an anti-fraud flag `[admin]`. DISMISS = false alarm (deleted clip is restored and its balance unfrozen when nothing
 * else holds it; a view-anomaly hold is released). CONFIRM = fraud (clip stays excluded, balance stays frozen / views stay held).
 */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const admin = await requireUser(req, ["ADMIN"]);
  const { action } = body.parse(await readJson(req));
  return ok({ flag: await resolveFlag((await params).id, action, admin.id) });
});
