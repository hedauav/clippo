import { z } from "zod";
import { rateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { explainBrief } from "@/lib/agents/creator";
import { getLlm } from "@/lib/ai/llm";
import { db } from "@/lib/db";
import { storySchema } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";

const body = z.object({ campaignId: z.string().min(1) });

/** Creator assistant: plain-language explanation of a campaign brief. Advice only. */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "assistant/creator/explain", 30, 3600);
  await requireUser(req, ["CREATOR"]);
  const { campaignId } = body.parse(await readJson(req));
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c || c.status !== "APPROVED") throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  const llm = getLlm();
  const r = await explainBrief(storySchema.parse(c.story), llm);
  return ok({ explanation: r.explanation, aiMode: llm.mode });
});
