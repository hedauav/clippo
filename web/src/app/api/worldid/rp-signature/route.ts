import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ok, readJson, route } from "@/lib/http";
import { createRpContext, worldIdAction } from "@/lib/worldid";

const ALLOWED = ["clippo-approve-campaign", "clippo-approve-split"];
const body = z.object({ action: z.string().optional() });

/**
 * Signs an IDKit 4.x request context (rp_context) server-side. The widget needs {app_id, rp_id, nonce, created_at,
 * expires_at, signature}. `action` defaults to the sign-up action; approval actions are allow-listed. 503 NOT_CONFIGURED
 * unless WORLD_ID_APP_ID / WORLD_ID_RP_ID / WORLD_ID_SIGNING_KEY are set.
 */
export const POST = route(async (req: Request) => {
  await requireUser(req);
  const v = body.parse(await readJson(req).catch(() => ({})));
  const action = v.action && ALLOWED.includes(v.action) ? v.action : worldIdAction();
  return ok({ rpContext: createRpContext(action) });
});
