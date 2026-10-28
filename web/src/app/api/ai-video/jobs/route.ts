import { z } from "zod";
import { rateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { getVideoGenerator } from "@/lib/video";
import { jobView } from "@/lib/video/jobs";

const body = z.object({
  prompt: z.string().min(10).max(2000),
  /** Must be literally true: the campaigner confirms they hold the rights to the content/likeness described. */
  rightsConfirmed: z.boolean(),
  campaignId: z.string().optional(),
});

/** Start an AI-generated source video. Output is always labelled AI-generated and needs explicit approval before launch. */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "ai-video/jobs", 5, 3600);
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const v = body.parse(await readJson(req));
  if (v.rightsConfirmed !== true) {
    throw new ApiError(400, "RIGHTS_NOT_CONFIRMED", "Confirm you hold the rights to the content described before generating a video");
  }
  if (v.campaignId) {
    const c = await db.campaign.findUnique({ where: { id: v.campaignId } });
    if (!c || c.campaignerId !== user.id) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
    if (c.status !== "DRAFT") throw new ApiError(409, "BAD_STATE", "Source can only change while the campaign is DRAFT");
  }
  const gen = getVideoGenerator();
  let providerJobId: string;
  try {
    ({ providerJobId } = await gen.start(v.prompt));
  } catch (e) {
    throw new ApiError(502, "PROVIDER_ERROR", e instanceof Error ? e.message : "Video provider unavailable");
  }
  const job = await db.videoJob.create({
    data: {
      campaignId: v.campaignId,
      requestedById: user.id,
      prompt: v.prompt,
      provider: gen.name,
      providerJobId,
      status: "QUEUED",
      rightsConfirmed: true,
    },
  });
  return ok({ job: jobView(job), generatorMode: gen.mode }, 201);
});

export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const jobs = await db.videoJob.findMany({ where: { requestedById: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return ok({ jobs: jobs.map((j) => jobView(j)) });
});
