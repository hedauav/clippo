import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiError, ok, route } from "@/lib/http";
import { assertOwner, fundAll, getHire, type IdCtx } from "@/lib/workspace/hires";

const body = z.object({ onchainId: z.string().min(1).max(100).optional(), txHash: z.string().max(100).optional() });

/** "Fund all": one HUMAN_SPLIT campaign covering every approved creator. Body is optional. */
export const POST = route(async (req: Request, { params }: IdCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const hire = await getHire((await params).id);
  assertOwner(user, hire);
  const raw = await req.text();
  let json: unknown = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "BAD_JSON", "Request body must be valid JSON");
    }
  }
  const v = body.parse(json);
  const { campaign, hire: updated, fundingIntent } = await fundAll(hire, v);
  return ok({ campaign, hire: { id: updated.id, status: updated.status, campaignId: updated.campaignId }, fundingIntent }, 201);
});
