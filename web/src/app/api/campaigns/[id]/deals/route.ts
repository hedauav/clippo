import { requireUser } from "@/lib/auth";
import { bandFor, dealTerms, dealView } from "@/lib/deals";
import { db } from "@/lib/db";
import { getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";

/**
 * Campaigner: every deal on the campaign (one per creator) with the viewer-safe deal view, the creator wallet/name and the
 * published limits, so the UI needs no creator picker. Counter-offers use POST /deal {creatorId, rate}; limits POST /deal/limits.
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  if (c.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  const terms = await dealTerms(c.id);
  const deals = await db.deal.findMany({ where: { campaignId: c.id }, orderBy: { updatedAt: "desc" } });
  const ids = deals.map((d) => d.creatorId);
  const [users, profiles] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, wallet: true } }),
    db.creatorProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, displayName: true } }),
  ]);
  let band = null;
  try {
    const b = bandFor(c, terms);
    band = { minRate: b.minRate, maxRate: b.maxRate, autoAcceptUpTo: b.autoAcceptUpTo ?? null };
  } catch {
    /* no terms published */
  }
  return ok({
    band,
    deals: await Promise.all(
      deals.map(async (d) => ({
        creatorId: d.creatorId,
        wallet: users.find((u) => u.id === d.creatorId)?.wallet ?? "",
        displayName: profiles.find((p) => p.userId === d.creatorId)?.displayName ?? null,
        updatedAt: d.updatedAt.toISOString(),
        deal: await dealView(d, c, terms, "campaigner"),
      })),
    ),
  });
});
