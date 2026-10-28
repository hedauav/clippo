import { rateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import type { Deal } from "@prisma/client";
import { assertVerifiedHuman } from "@/lib/worldid/signup";
import { requireUser } from "@/lib/auth";
import { checkOffer, counterOffer, phraseNote } from "@/lib/agents/negotiator";
import { getLlm } from "@/lib/ai/llm";
import { bandFor, dealTerms, dealView, findDeal, offersOf, type Offer } from "@/lib/deals";
import { db } from "@/lib/db";
import { getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { notify } from "@/lib/notify";

const body = z.object({
  rate: z.number().positive().max(10_000),
  note: z.string().max(500).default(""),
  /** creator only: private floor; offers and counters never go below it */
  minRate: z.number().positive().max(10_000).optional(),
  /** campaigner only: which creator the offer is for */
  creatorId: z.string().optional(),
});

export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CREATOR", "CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  if (user.role === "CREATOR" && c.status !== "APPROVED") throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  const terms = await dealTerms(c.id);
  const deal = await findDeal(user, c, new URL(req.url).searchParams.get("creatorId"));
  const side = user.role === "CREATOR" ? "creator" : "campaigner";
  let band = null;
  try {
    const b = bandFor(c, terms);
    band = { minRate: b.minRate, maxRate: b.maxRate, ...(side === "campaigner" ? { autoAcceptUpTo: b.autoAcceptUpTo ?? null } : {}) };
  } catch {
    /* no terms published */
  }
  return ok({ deal: deal ? await dealView(deal, c, terms, side) : null, band });
});

/** Make an offer. Creator offers are answered by the negotiator inside the limits both sides set; a deal needs both to accept. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  await rateLimit(req, "campaigns/[id]/deal", 30, 3600);
  const user = await requireUser(req, ["CREATOR", "CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  if (c.status !== "APPROVED") throw new ApiError(409, "BAD_STATE", "Deals are only open on live campaigns");
  const v = body.parse(await readJson(req));
  const side = user.role === "CREATOR" ? ("creator" as const) : ("campaigner" as const);
  let creatorId: string;
  if (side === "creator") {
    assertVerifiedHuman(user, "deals");
    creatorId = user.id;
  } else {
    if (c.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
    if (!v.creatorId) throw new ApiError(400, "BAD_REQUEST", "creatorId is required for campaigner offers");
    const target = await db.user.findUnique({ where: { id: v.creatorId } });
    if (!target || target.role !== "CREATOR") throw new ApiError(404, "NOT_FOUND", "Creator not found");
    creatorId = target.id;
  }

  const terms = await dealTerms(c.id);
  const band = bandFor(c, terms);
  let deal: Deal | null = await db.deal.findUnique({ where: { campaignId_creatorId: { campaignId: c.id, creatorId } } });
  if (deal && (deal.status === "ACCEPTED" || deal.status === "DECLINED")) throw new ApiError(409, "BAD_STATE", `Deal is already ${deal.status}`);
  const creatorMin = side === "creator" && v.minRate !== undefined ? v.minRate : (deal?.creatorMinRate ?? null);

  const check = checkOffer(v.rate, band, creatorMin);
  if (!check.ok) throw new ApiError(check.code === "NO_OVERLAP" ? 409 : 400, check.code, check.message);

  const now = () => new Date().toISOString();
  const offers: Offer[] = [...(deal ? offersOf(deal) : []), { by: side, rate: v.rate, note: v.note, at: now() }];
  let campaignerAccepted = false;
  if (side === "creator") {
    const counter = counterOffer(v.rate, band, creatorMin, c.ratePer1k);
    if (counter.action === "ACCEPT_FOR_CAMPAIGNER") {
      offers.push({ by: "negotiator", rate: counter.rate, note: await phraseNote(getLlm(), counter), at: now() });
      campaignerAccepted = true; // the campaigner's own standing instruction (autoAcceptUpTo); the creator must still accept
    } else if (counter.action === "COUNTER") {
      offers.push({ by: "negotiator", rate: counter.rate, note: await phraseNote(getLlm(), counter), at: now() });
    }
  }
  const data = {
    offers: offers as unknown as object,
    status: offers.length > 1 ? "COUNTERED" : "PROPOSED",
    creatorMinRate: creatorMin,
    creatorAccepted: false,
    campaignerAccepted,
  };
  deal = deal
    ? await db.deal.update({ where: { id: deal.id }, data })
    : await db.deal.create({ data: { campaignId: c.id, campaignerId: c.campaignerId, creatorId, ...data } });

  await notify({
    userId: side === "creator" ? c.campaignerId : creatorId,
    type: "DEAL_OFFER",
    title: `New rate offer on "${c.title}"`,
    body: `$${v.rate.toFixed(2)} per 1K views${v.note ? `: ${v.note.slice(0, 200)}` : ""}`,
    refType: "deal",
    refId: deal.id,
  });
  return ok({ deal: await dealView(deal, c, terms, side) }, 201);
});
