import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaignView, platformEnum, storySchema } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";

const createSchema = z
  .object({
    title: z.string().min(1).max(200),
    story: storySchema,
    contentSource: z.enum(["UPLOAD", "LINK", "AI_GENERATED"]),
    contentUrl: z.string().max(2000).optional(),
    platforms: z.array(platformEnum).min(1),
    payoutMode: z.enum(["PER_VIEW", "HUMAN_SPLIT", "POOL_SHARE"]),
    poolShareBasis: z.enum(["VIEWS", "APPROVED_CLIPS"]).optional(),
    approver: z.enum(["CAMPAIGNER_ONLY", "CAMPAIGNER_AND_ADMIN"]).optional(),
    poolSize: z.number().positive(),
    ratePer1k: z.number().positive().optional(),
    viewTarget: z.number().int().positive().optional(),
    eligibility: z.enum(["ANYONE_VERIFIED", "HIGHER_RANKED"]).default("ANYONE_VERIFIED"),
  })
  .superRefine((v, ctx) => {
    if (v.payoutMode === "PER_VIEW" && !v.ratePer1k) ctx.addIssue({ code: "custom", path: ["ratePer1k"], message: "required for PER_VIEW" });
    if (v.payoutMode === "POOL_SHARE" && !v.poolShareBasis) ctx.addIssue({ code: "custom", path: ["poolShareBasis"], message: "required for POOL_SHARE" });
    if (v.payoutMode === "HUMAN_SPLIT" && !v.approver) ctx.addIssue({ code: "custom", path: ["approver"], message: "required for HUMAN_SPLIT" });
  });

/** Create a DRAFT campaign (campaigner). */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const v = createSchema.parse(await readJson(req));
  const c = await db.campaign.create({
    data: {
      campaignerId: user.id,
      title: v.title,
      story: v.story,
      contentSource: v.contentSource,
      contentUrl: v.contentUrl,
      platforms: v.platforms,
      payoutMode: v.payoutMode,
      poolShareBasis: v.payoutMode === "POOL_SHARE" ? v.poolShareBasis : null,
      approver: v.payoutMode === "HUMAN_SPLIT" ? v.approver : null,
      poolSize: v.poolSize,
      ratePer1k: v.payoutMode === "PER_VIEW" ? v.ratePer1k : null,
      viewTarget: v.viewTarget,
      eligibility: v.eligibility,
    },
  });
  return ok({ campaign: campaignView(c) }, 201);
});

/**
 * List campaigns. Anonymous/creators: APPROVED only. Campaigners: pass mine=true for their own (all statuses).
 * Admin: all, optionally filtered with ?status=.
 */
export const GET = route(async (req: Request) => {
  const user = await getUser(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const mine = url.searchParams.get("mine") === "true";
  const where: Prisma.CampaignWhereInput = {};
  if (mine) {
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in first");
    where.campaignerId = user.id;
    if (status) where.status = status as never;
  } else if (user?.role === "ADMIN") {
    if (status) where.status = status as never;
  } else {
    where.status = "APPROVED";
  }
  const rows = await db.campaign.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { submissions: true } } },
  });
  return ok({ campaigns: rows.map(campaignView) });
});
