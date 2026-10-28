import type { Campaign, SourceAsset, User } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./http";
import { getStorage } from "./storage";
import { parseRange } from "./storage/files";
import { jobIdFromUrl } from "./video/jobs";

/**
 * Owner, admin, or any signed-in user once the asset's campaign is open for clipping. A campaign may reference the
 * asset only by URL (wizard sets contentUrl before attaching), so `needle` (default: the asset id) is also matched there.
 */
export async function canReadAsset(user: User | null, asset: SourceAsset, needle = asset.id): Promise<boolean> {
  if (!user) return false;
  if (user.role === "ADMIN" || asset.ownerId === user.id) return true;
  const c = await db.campaign.findFirst({
    where: { OR: [...(asset.campaignId ? [{ id: asset.campaignId }] : []), { contentUrl: { contains: needle } }], status: { in: ["APPROVED", "CLOSED"] } },
    select: { id: true },
  });
  return !!c;
}

/** Stream a stored asset with Range support (playback) or as an attachment (download). */
export async function assetResponse(req: Request, asset: SourceAsset, download: boolean): Promise<Response> {
  if (!asset.storageKey) throw new ApiError(404, "NOT_FOUND", "This source is a link, not a stored file");
  const storage = getStorage();
  const size = await storage.size(asset.storageKey);
  if (size == null) throw new ApiError(404, "NOT_FOUND", "File missing from storage");
  const headers: Record<string, string> = {
    "content-type": asset.mime ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=0, must-revalidate",
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${(asset.filename ?? "source.mp4").replace(/[^A-Za-z0-9._ -]/g, "_")}"`,
  };
  if (asset.aiGenerated) headers["x-clippo-ai-generated"] = "true";
  const range = parseRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  if (range) {
    return new Response(await storage.read(asset.storageKey, range), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(range.end - range.start + 1) },
    });
  }
  return new Response(await storage.read(asset.storageKey), { status: 200, headers: { ...headers, "content-length": String(size) } });
}

/** Only absolute http(s) links, bounded length, no credentials. */
export function validateSourceLink(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(400, "BAD_LINK", "Not a valid URL");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new ApiError(400, "BAD_LINK", "Only plain http(s) links are accepted");
  return u.toString();
}

export const assetView = (a: SourceAsset) => ({
  id: a.id,
  kind: a.kind,
  name: a.filename,
  size: a.size,
  mime: a.mime,
  url: a.storageKey ? `/api/uploads/${a.id}/file` : a.linkUrl,
  downloadUrl: a.storageKey ? `/api/uploads/${a.id}/file?download=1` : null,
  aiGenerated: a.aiGenerated,
  label: a.aiGenerated ? "AI-GENERATED" : null,
  campaignId: a.campaignId,
});

/**
 * Launch gate (PRD 4.8): an AI-generated source needs the campaigner's rights confirmation AND explicit approval of the
 * rendered output before the campaign can go live. No-op for UPLOAD / LINK campaigns.
 */
export async function assertSourceReadyForLaunch(c: Campaign): Promise<void> {
  if (c.contentSource !== "AI_GENERATED") return;
  const linkedId = jobIdFromUrl(c.contentUrl);
  const job = await db.videoJob.findFirst({
    where: { OR: [{ campaignId: c.id }, ...(linkedId ? [{ id: linkedId }] : [])], requestedById: c.campaignerId },
    orderBy: { createdAt: "desc" },
  });
  if (!job || job.status !== "SUCCEEDED" || !job.outputAssetId) {
    throw new ApiError(409, "SOURCE_NOT_READY", "The AI-generated source video has not finished rendering");
  }
  if (!job.rightsConfirmed) throw new ApiError(409, "RIGHTS_NOT_CONFIRMED", "The campaigner has not confirmed rights to use the generated video");
  if (job.approvalStatus !== "APPROVED" || job.approvedById !== c.campaignerId) {
    throw new ApiError(409, "SOURCE_NOT_APPROVED", "The campaigner must approve the AI-generated video before launch");
  }
}
