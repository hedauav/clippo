import type { VideoJob } from "@prisma/client";
import { db } from "../db";
import { getStorage } from "../storage";
import { newStorageKey } from "../storage/files";
import { getVideoGenerator } from "./index";

export const AI_LABEL = "AI-GENERATED" as const;

export type AiJobStatus = "queued" | "rendering" | "ready" | "failed" | "approved";

/** Shape consumed by the UI (AiJob in ui-mocks/ext.ts). `videoUrl` only once rendered; always labelled AI-generated. */
export function jobView(j: VideoJob, progress = j.status === "SUCCEEDED" ? 100 : 0) {
  const status: AiJobStatus =
    j.status === "FAILED" ? "failed" : j.status === "SUCCEEDED" ? (j.approvalStatus === "APPROVED" ? "approved" : "ready") : j.status === "RUNNING" ? "rendering" : "queued";
  return {
    id: j.id,
    status,
    progress,
    prompt: j.prompt,
    videoUrl: j.status === "SUCCEEDED" && j.outputAssetId ? `/api/ai-video/jobs/${j.id}/video` : null,
    label: AI_LABEL,
    aiGenerated: true,
    rightsConfirmed: j.rightsConfirmed,
    approvalStatus: j.approvalStatus,
    campaignId: j.campaignId,
    error: j.error ?? undefined,
  };
}

/** Poll the provider and persist the outcome. On success the output is stored as an AI-generated SourceAsset. */
export async function refreshJob(job: VideoJob): Promise<{ job: VideoJob; progress: number }> {
  if (job.status === "SUCCEEDED" || job.status === "FAILED" || !job.providerJobId) return { job, progress: job.status === "SUCCEEDED" ? 100 : 0 };
  const gen = getVideoGenerator();
  let p;
  try {
    p = await gen.poll(job.providerJobId);
  } catch {
    // transient provider error: keep job as is, next poll retries
    return { job, progress: 0 };
  }
  if (p.status === "QUEUED" || p.status === "RUNNING") {
    if (p.status !== job.status) job = await db.videoJob.update({ where: { id: job.id }, data: { status: p.status } });
    return { job, progress: p.progress };
  }
  if (p.status === "FAILED" || !p.output) {
    job = await db.videoJob.update({ where: { id: job.id }, data: { status: "FAILED", error: p.error ?? "Generation failed" } });
    return { job, progress: 0 };
  }
  // Claim the transition so concurrent polls store the output once.
  const claimed = await db.videoJob.updateMany({ where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "SUCCEEDED" } });
  if (claimed.count === 0) return { job: (await db.videoJob.findUnique({ where: { id: job.id } })) ?? job, progress: 100 };
  try {
    const mime = p.output.mime;
    const ext = mime === "video/webm" ? "webm" : mime === "video/quicktime" ? "mov" : "mp4";
    const key = newStorageKey(job.requestedById, ext);
    await getStorage().put(key, p.output.data, mime);
    const asset = await db.sourceAsset.create({
      data: {
        ownerId: job.requestedById,
        campaignId: job.campaignId,
        kind: "AI_GENERATED",
        filename: `ai-generated-${job.id}.${ext}`,
        storageKey: key,
        mime,
        size: p.output.data.length,
        aiGenerated: true,
      },
    });
    job = await db.videoJob.update({ where: { id: job.id }, data: { outputAssetId: asset.id } });
  } catch {
    job = await db.videoJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "Could not store the generated video" } });
  }
  return { job, progress: job.status === "SUCCEEDED" ? 100 : 0 };
}

/** Job id referenced by a campaign contentUrl like /api/ai-video/jobs/<id>/video. */
export const jobIdFromUrl = (url: string | null | undefined) => url?.match(/\/api\/ai-video\/jobs\/([A-Za-z0-9]+)\/video/)?.[1] ?? null;
