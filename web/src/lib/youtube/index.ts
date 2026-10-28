import { getOverride, requireEnv } from "../config";

export interface VideoInfo {
  videoId: string;
  channelHandle: string | null;
  channelExternalId: string | null;
  title: string;
  description: string;
  /** null = transcript unavailable -> clip must go to human review */
  transcript: string | null;
  views: number;
  publishedAt: string | null;
}

export interface YouTubeClient {
  readonly mode: string;
  /** Check that the verification code appears in the channel bio. */
  checkChannelCode(handle: string, code: string): Promise<{ ok: boolean; externalId?: string; reason?: string; /** platform could not be read automatically -> human review */ unavailable?: boolean }>;
  fetchVideo(link: string, hint?: { channelHandle?: string; channelId?: string }): Promise<VideoInfo>;
  getViews(videoId: string, ctx?: { channelId?: string }): Promise<number>;
  /** Optional override of the public-availability probe (tests). */
  availability?(videoId: string): Promise<"available" | "gone" | "unknown">;
}

export function parseVideoId(link: string): string | null {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
        id = m ? m[1] : null;
      }
    }
    return id && /^[\w-]{3,32}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const normalizeHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

/* ---------------- Real (YouTube Data API v3) ---------------- */

export class RealYouTube implements YouTubeClient {
  readonly mode = "real" as const;
  constructor(private key: string) {}

  private async api<T>(path: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams({ ...params, key: this.key });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`);
    if (!res.ok) throw new Error(`YouTube API ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  async checkChannelCode(handle: string, code: string) {
    const r = await this.api<{ items?: { id: string; snippet: { description: string } }[] }>("channels", {
      part: "snippet",
      forHandle: `@${normalizeHandle(handle)}`,
    });
    const ch = r.items?.[0];
    if (!ch) return { ok: false, reason: "Channel not found" };
    if (!ch.snippet.description.includes(code)) return { ok: false, reason: "Code not found in channel bio" };
    return { ok: true, externalId: ch.id };
  }

  async fetchVideo(link: string): Promise<VideoInfo> {
    const videoId = parseVideoId(link);
    if (!videoId) throw new Error("Not a valid YouTube video link");
    const r = await this.api<{
      items?: {
        snippet: { title: string; description: string; channelId: string; publishedAt: string };
        statistics: { viewCount?: string };
      }[];
    }>("videos", { part: "snippet,statistics", id: videoId });
    const v = r.items?.[0];
    if (!v) throw new Error("Video not found or not public");
    const transcript = await this.tryTranscript(videoId);
    const ch = await this.api<{ items?: { snippet: { customUrl?: string } }[] }>("channels", {
      part: "snippet",
      id: v.snippet.channelId,
    });
    const customUrl = ch.items?.[0]?.snippet.customUrl ?? null;
    return {
      videoId,
      channelHandle: customUrl ? normalizeHandle(customUrl) : null,
      channelExternalId: v.snippet.channelId,
      title: v.snippet.title,
      description: v.snippet.description,
      transcript,
      views: Number(v.statistics.viewCount ?? 0),
      publishedAt: v.snippet.publishedAt,
    };
  }

  /**
   * Public caption fetch: reads the caption-track list from the watch page player response (the Data API only
   * downloads captions for the video owner via OAuth), prefers English (manual over auto), downloads json3.
   * Returns null when there are no captions or YouTube blocks the request -> the verifier routes the clip to
   * human review (PRD 4.7); it is never auto-approved.
   */
  private async tryTranscript(videoId: string): Promise<string | null> {
    try {
      const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
        headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (compatible; ClippoVerifier/1.0)" },
      });
      if (!page.ok) return null;
      const html = await page.text();
      const m = html.match(/"captionTracks":(\[.*?\]),"audioTracks"/s);
      if (!m) return null;
      const tracks = JSON.parse(m[1]) as { baseUrl: string; languageCode: string; kind?: string }[];
      const track = tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ?? tracks.find((t) => t.languageCode.startsWith("en")) ?? tracks[0];
      if (!track?.baseUrl) return null;
      const u = new URL(track.baseUrl);
      if (u.hostname !== "youtube.com" && !u.hostname.endsWith(".youtube.com")) return null;
      u.searchParams.set("fmt", "json3");
      const res = await fetch(u);
      if (!res.ok) return null;
      const j = JSON.parse(await res.text()) as { events?: { segs?: { utf8: string }[] }[] };
      const out = (j.events ?? []).flatMap((e) => e.segs ?? []).map((x) => x.utf8).join(" ").replace(/\s+/g, " ").trim();
      return out || null;
    } catch {
      return null;
    }
  }

  async getViews(videoId: string) {
    const r = await this.api<{ items?: { statistics: { viewCount?: string } }[] }>("videos", {
      part: "statistics",
      id: videoId,
    });
    return Number(r.items?.[0]?.statistics.viewCount ?? 0);
  }
}

export function getYouTube(): YouTubeClient {
  return getOverride<YouTubeClient>("youtube") ?? new RealYouTube(requireEnv("YouTube Data API", "YOUTUBE_API_KEY"));
}
