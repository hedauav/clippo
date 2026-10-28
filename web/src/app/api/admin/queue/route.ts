import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/http";
import { pendingProposals } from "@/lib/proposals";

/** Admin oversight queue: campaigns awaiting approval, clips needing human review, pending appeals, anti-fraud flags (view spikes, deleted clips). */
export const GET = route(async (req: Request) => {
  await requireUser(req, ["ADMIN"]);
  const subInclude = {
    verdict: true,
    creator: { select: { id: true, wallet: true } },
    campaign: { select: { id: true, title: true, approver: true } },
  } as const;
  const [pendingCampaigns, flaggedSubmissions, appeals, fraudFlags, splitProposals] = await Promise.all([
    db.campaign.findMany({ where: { status: "FUNDED" }, orderBy: { createdAt: "asc" } }),
    db.submission.findMany({ where: { verdict: { result: "NEEDS_HUMAN" } }, orderBy: { createdAt: "asc" }, include: subInclude }),
    db.submission.findMany({ where: { verdict: { appealStatus: "PENDING" } }, orderBy: { createdAt: "asc" }, include: subInclude }),
    db.fraudFlag.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" } }),
    pendingProposals(),
  ]);
  return ok({ pendingCampaigns, flaggedSubmissions, appeals, fraudFlags, splitProposals });
});
