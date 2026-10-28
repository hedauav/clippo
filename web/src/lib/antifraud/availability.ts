/**
 * Is the YouTube video still public? Used by the refresh job to detect clips deleted/privated after approval (PRD 5.x unpaid
 * balance rule). Failures to ask (network, quota) return "unknown" and are treated as still available: we only freeze on a
 * definite "gone" answer.
 */
import { getOverride, requireEnv } from "../config";
import type { YouTubeClient } from "../youtube";

export type Availability = "available" | "gone" | "unknown";

export async function checkAvailability(videoId: string): Promise<Availability> {
  const o = getOverride<YouTubeClient>("youtube");
  if (o?.availability) return o.availability(videoId);
  const key = requireEnv("YouTube Data API", "YOUTUBE_API_KEY");
  try {
    const qs = new URLSearchParams({ part: "status", id: videoId, key });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${qs}`);
    if (!res.ok) return "unknown";
    const j = (await res.json()) as { items?: { status?: { privacyStatus?: string } }[] };
    const item = j.items?.[0];
    if (!item) return "gone"; // deleted, or private to everyone but the owner
    return item.status?.privacyStatus === "private" ? "gone" : "available";
  } catch {
    return "unknown";
  }
}
