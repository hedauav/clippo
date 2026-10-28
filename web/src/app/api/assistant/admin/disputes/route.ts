import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { summariseAndRankDisputes, type DisputeInput } from "@/lib/agents/admin";
import { shortWallet } from "@/lib/agents/ask";
import { getLlm } from "@/lib/ai/llm";
import { db } from "@/lib/db";
import { storySchema } from "@/lib/domain";
import { ok, route } from "@/lib/http";
import { latestPerSubmission } from "@/lib/snapshots";

/**
 * Admin assistant: open appeals and clips flagged for human review, summarised with a recommendation and ranked so the
 * admin looks at the most valuable / oldest / most unclear first. Read-only advice: it changes no verdict and no funds.
 */
export const GET = route(async (req: Request) => {
  await rateLimit(req, "assistant/admin/disputes", 30, 3600);
  await requireUser(req, ["ADMIN"]);
  const rows = await db.submission.findMany({
    where: { verdict: { OR: [{ result: "NEEDS_HUMAN" }, { appealStatus: "PENDING" }] } },
    include: { verdict: true, creator: { select: { wallet: true } }, campaign: { select: { title: true, story: true, platforms: true } } },
    take: 100,
  });
  const views = new Map((await latestPerSubmission()).map((s) => [s.submissionId, s.cumulativeViews]));
  const now = Date.now();
  const inputs: DisputeInput[] = rows.flatMap((s) => {
    const story = storySchema.safeParse(s.campaign.story);
    if (!s.verdict || !story.success) return [];
    const meta = s.metadata as { title?: string; views?: number } | null;
    const appealOpen = s.verdict.appealStatus === "PENDING";
    const since = appealOpen ? s.verdict.updatedAt : s.createdAt;
    return [
      {
        id: s.id,
        title: `${appealOpen ? "Appeal" : "Flagged"}: ${meta?.title || s.campaign.title}`,
        creator: shortWallet(s.creator.wallet),
        verdictResult: s.verdict.result,
        verdictReason: s.verdict.reason,
        confidence: s.verdict.confidence,
        flags: Array.isArray(s.verdict.flags) ? (s.verdict.flags as string[]) : [],
        appealNote: s.verdict.appealNote ?? "",
        appealOpen,
        ageHours: Math.max(0, (now - since.getTime()) / 3600_000),
        views: views.get(s.id) ?? meta?.views ?? 0,
        transcript: s.transcript,
        story: story.data,
        campaignPlatforms: s.campaign.platforms as string[],
      },
    ];
  });
  const llm = getLlm();
  const r = await summariseAndRankDisputes(inputs, llm);
  return ok({ disputes: r.disputes, aiMode: llm.mode });
});
