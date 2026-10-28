import { z } from "zod";
import { rateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { precheck, riskLevel } from "@/lib/agents/creator";
import { db } from "@/lib/db";
import { storySchema } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";

const body = z.object({
  campaignId: z.string().min(1),
  link: z.string().max(2000).optional(),
  caption: z.string().max(20000).optional(),
  transcript: z.string().max(50000).optional(),
  script: z.string().max(50000).optional(),
});

/**
 * Creator assistant: pre-submit rejection-risk warning for a draft clip (what the verifier would likely flag).
 * Deterministic rules mirroring the verifier; it never submits anything and does not store the text.
 */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "assistant/creator/check", 30, 3600);
  await requireUser(req, ["CREATOR"]);
  const v = body.parse(await readJson(req));
  const c = await db.campaign.findUnique({ where: { id: v.campaignId } });
  if (!c || c.status !== "APPROVED") throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  const risks = precheck({
    story: storySchema.parse(c.story),
    text: [v.caption, v.script, v.transcript].filter(Boolean).join("\n"),
    link: v.link,
    campaignPlatforms: c.platforms as string[],
  });
  return ok({ risks, riskLevel: riskLevel(risks) });
});
