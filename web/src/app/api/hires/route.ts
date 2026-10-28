import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { hireView, newToken } from "@/lib/workspace/hires";
import { priceFromCard, type RateCard } from "@/lib/workspace/money";

const body = z.object({
  title: z.string().trim().min(1).max(200),
  briefId: z.string().optional(),
  /** Optional: seed creators from a shortlist (each added PROPOSED at their lowest rate line, quantity 1). */
  shortlistId: z.string().optional(),
});

export const POST = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const v = body.parse(await readJson(req));
  if (v.briefId) {
    const b = await db.hireBrief.findUnique({ where: { id: v.briefId } });
    if (!b || b.campaignerId !== user.id) throw new ApiError(404, "NOT_FOUND", "Brief not found");
  }
  let shortlistCreatorIds: string[] = [];
  if (v.shortlistId) {
    const s = await db.shortlist.findUnique({ where: { id: v.shortlistId } });
    if (!s || s.ownerId !== user.id) throw new ApiError(404, "NOT_FOUND", "Shortlist not found");
    shortlistCreatorIds = (await db.shortlistItem.findMany({ where: { shortlistId: s.id } })).map((i) => i.creatorId);
  }
  const hire = await db.hire.create({
    data: { campaignerId: user.id, title: v.title, briefId: v.briefId, shareToken: newToken() },
  });
  const profiles = await db.creatorProfile.findMany({ where: { userId: { in: shortlistCreatorIds }, listed: true } });
  for (const p of profiles) {
    const card = p.rateCard as RateCard;
    const low = card.reduce((a, b) => (b.price < a.price ? b : a));
    await db.hireCreator.create({
      data: { hireId: hire.id, creatorId: p.userId, rateLabel: low.label, quantity: 1, amount: priceFromCard(card, low.label, 1) },
    });
  }
  return ok(await hireView(hire, { includeToken: true }), 201);
});

/** Campaigner: own hires. Creator: hires they are on. */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER", "CREATOR", "ADMIN"]);
  let hires;
  if (user.role === "CREATOR") {
    const mine = await db.hireCreator.findMany({ where: { creatorId: user.id }, select: { hireId: true } });
    hires = await db.hire.findMany({ where: { id: { in: mine.map((m) => m.hireId) } }, orderBy: { createdAt: "desc" } });
  } else {
    hires = await db.hire.findMany({
      where: user.role === "ADMIN" ? {} : { campaignerId: user.id },
      orderBy: { createdAt: "desc" },
    });
  }
  return ok({
    hires: hires.map((h) => ({ id: h.id, title: h.title, status: h.status, campaignId: h.campaignId, createdAt: h.createdAt })),
  });
});
