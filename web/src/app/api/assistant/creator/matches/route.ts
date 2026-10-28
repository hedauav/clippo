import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { matchCampaigns } from "@/lib/agents/creator";
import { db } from "@/lib/db";
import { HIGHER_RANK_MIN_APPROVED, creatorRank, storySchema } from "@/lib/domain";
import { ok, route } from "@/lib/http";

/** Creator assistant: open campaigns ranked by fit with the creator's verified channels and past approved clips. */
export const GET = route(async (req: Request) => {
  await rateLimit(req, "assistant/creator/matches", 60, 3600);
  const user = await requireUser(req, ["CREATOR"]);
  const [channels, approved, campaigns, rank, submitted] = await Promise.all([
    db.channel.findMany({ where: { userId: user.id, verified: true }, select: { platform: true } }),
    db.submission.findMany({ where: { creatorId: user.id, verdict: { result: "APPROVE" } }, select: { campaign: { select: { story: true } } }, take: 50 }),
    db.campaign.findMany({ where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 100 }),
    creatorRank(user.id),
    db.submission.findMany({ where: { creatorId: user.id }, select: { campaignId: true } }),
  ]);
  const done = new Set(submitted.map((s) => s.campaignId));
  const matches = matchCampaigns(
    {
      channelPlatforms: channels.map((c) => c.platform),
      pastTopics: approved.map((a) => storySchema.safeParse(a.campaign.story)).flatMap((p) => (p.success ? [p.data.topic] : [])),
    },
    campaigns
      .filter((c) => !done.has(c.id))
      .map((c) => {
        const story = storySchema.safeParse(c.story);
        return {
          id: c.id,
          title: c.title,
          topic: story.success ? story.data.topic : c.title,
          platforms: c.platforms as string[],
          payMode: c.payoutMode,
          ratePer1k: c.ratePer1k,
          poolSize: c.poolSize,
          eligible: c.eligibility !== "HIGHER_RANKED" || rank >= HIGHER_RANK_MIN_APPROVED,
        };
      }),
  );
  return ok({ matches });
});
