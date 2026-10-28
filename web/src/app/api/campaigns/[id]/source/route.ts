import { z } from "zod";
import { getUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageCampaign, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { assertSourceReadyForLaunch, assetView, canReadAsset, validateSourceLink } from "@/lib/source";
import { jobIdFromUrl, jobView } from "@/lib/video/jobs";

const body = z.union([
  z.object({ uploadId: z.string().min(1) }),
  z.object({ url: z.string().min(1).max(2000) }),
  z.object({ jobId: z.string().min(1) }),
]);

/** Attach a source to a DRAFT campaign: an upload (`uploadId`), a link-a-video URL (`url`), or an AI video job (`jobId`). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  if (c.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  if (c.status !== "DRAFT") throw new ApiError(409, "BAD_STATE", `Source can only change while the campaign is DRAFT (it is ${c.status})`);
  const v = body.parse(await readJson(req));

  if ("url" in v) {
    const url = validateSourceLink(v.url);
    await db.sourceAsset.create({ data: { ownerId: user.id, campaignId: c.id, kind: "LINK", linkUrl: url } });
    const campaign = await db.campaign.update({ where: { id: c.id }, data: { contentSource: "LINK", contentUrl: url } });
    return ok({ campaign, source: { kind: "LINK", url } });
  }
  if ("uploadId" in v) {
    const a = await db.sourceAsset.findUnique({ where: { id: v.uploadId } });
    if (!a || a.ownerId !== user.id || a.kind !== "UPLOAD") throw new ApiError(404, "NOT_FOUND", "Upload not found");
    await db.sourceAsset.update({ where: { id: a.id }, data: { campaignId: c.id } });
    const campaign = await db.campaign.update({ where: { id: c.id }, data: { contentSource: "UPLOAD", contentUrl: assetView(a).url } });
    return ok({ campaign, source: assetView(a) });
  }
  const job = await db.videoJob.findUnique({ where: { id: v.jobId } });
  if (!job || job.requestedById !== user.id) throw new ApiError(404, "NOT_FOUND", "Video job not found");
  await db.videoJob.update({ where: { id: job.id }, data: { campaignId: c.id } });
  if (job.outputAssetId) await db.sourceAsset.update({ where: { id: job.outputAssetId }, data: { campaignId: c.id } });
  const campaign = await db.campaign.update({
    where: { id: c.id },
    data: { contentSource: "AI_GENERATED", contentUrl: `/api/ai-video/jobs/${job.id}/video` },
  });
  return ok({ campaign, source: { kind: "AI_GENERATED", job: jobView(job) }, launchReady: await launchReady(campaign) });
});

async function launchReady(c: Parameters<typeof assertSourceReadyForLaunch>[0]) {
  try {
    await assertSourceReadyForLaunch(c);
    return { ready: true as const };
  } catch (e) {
    return { ready: false as const, code: e instanceof ApiError ? e.code : "ERROR", reason: e instanceof Error ? e.message : "" };
  }
}

/** Current source of a campaign (managers any time; others once it is open) plus launch readiness for AI video. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await getUser(req);
  const c = await getCampaign((await params).id);
  const manage = !!user && canManageCampaign(user, c);
  if (!manage && !(user && (c.status === "APPROVED" || c.status === "CLOSED"))) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  const asset =
    c.contentSource === "LINK"
      ? null
      : await db.sourceAsset.findFirst({ where: { campaignId: c.id, kind: c.contentSource }, orderBy: { createdAt: "desc" } });
  const jobId = jobIdFromUrl(c.contentUrl);
  const job = c.contentSource === "AI_GENERATED" ? await db.videoJob.findFirst({ where: { OR: [{ campaignId: c.id }, ...(jobId ? [{ id: jobId }] : [])] }, orderBy: { createdAt: "desc" } }) : null;
  return ok({
    contentSource: c.contentSource,
    url: c.contentUrl,
    asset: asset && (manage || (await canReadAsset(user, asset))) ? assetView(asset) : null,
    job: job && manage ? jobView(job) : null,
    launchReady: manage ? await launchReady(c) : undefined,
  });
});
