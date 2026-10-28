import { requireUser } from "@/lib/auth";
import { analyseGrowth, dailyGains } from "@/lib/agents/admin";
import { shortWallet } from "@/lib/agents/ask";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/http";

/**
 * Admin assistant: approved clips whose daily view gains look suspicious (a spike far above the clip's own typical day,
 * or most views arriving in a two-day burst). `?all=true` also lists clips that were not flagged.
 */
export const GET = route(async (req: Request) => {
  await requireUser(req, ["ADMIN"]);
  const all = new URL(req.url).searchParams.get("all") === "true";
  const subs = await db.submission.findMany({
    where: { verdict: { result: "APPROVE" }, campaign: { status: "APPROVED" } },
    include: {
      snapshots: { orderBy: { day: "asc" }, select: { cumulativeViews: true } },
      campaign: { select: { title: true } },
      creator: { select: { wallet: true } },
    },
    take: 500,
  });
  // "held" = an open/confirmed VIEW_ANOMALY fraud flag exists (the same hold the snapshot feed already honours).
  const heldIds = new Set(
    (await db.fraudFlag.findMany({ where: { kind: "VIEW_ANOMALY", status: { in: ["OPEN", "CONFIRMED"] }, submissionId: { in: subs.map((s) => s.id) } }, select: { submissionId: true } })).map((f) => f.submissionId),
  );
  const anomalies = subs.flatMap((s) => {
    const daily = dailyGains(s.snapshots.map((x) => x.cumulativeViews));
    const g = analyseGrowth(daily);
    if (!g.flagged && !heldIds.has(s.id) && !all) return [];
    return [
      {
        id: s.id,
        campaign: s.campaign.title,
        creator: shortWallet(s.creator.wallet),
        link: s.link,
        daily,
        baseline: g.baseline,
        peakRatio: g.peakRatio,
        flagged: g.flagged,
        note: g.note,
        held: heldIds.has(s.id),
      },
    ];
  });
  anomalies.sort((a, b) => b.peakRatio - a.peakRatio);
  return ok({ anomalies });
});
