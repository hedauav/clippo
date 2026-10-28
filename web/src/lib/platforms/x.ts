import { getOverride, requireEnv } from "../config";
import { PlatformUnavailableError, type PlatformClient, type VideoInfo } from "./types";

export const normalizeXHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();
export const isValidXHandle = (h: string) => /^[a-z0-9_]{1,15}$/.test(normalizeXHandle(h));

/** Accepts x.com / twitter.com status links; returns the numeric post id. */
export function parseXPostId(link: string): string | null {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\.|^mobile\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    const m = u.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status\/(\d{1,25})(?:\/|$)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Author handle written in the link (only a hint; the real client trusts the API's author id instead). */
export function xHandleFromLink(link: string): string | null {
  try {
    const m = new URL(link).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\//);
    return m && m[1] !== "i" ? normalizeXHandle(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Real X API v2 (needs X_BEARER_TOKEN and an API tier that allows reads). The spoken audio of an X video is not
 * exposed, so `transcript` is always null and every clip goes to human review (post text goes in `description`).
 * Access failures (401/402/403/429) raise PlatformUnavailableError -> human review.
 */
export class RealX implements PlatformClient {
  readonly mode = "real" as const;
  constructor(private token: string) {}

  private async api<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://api.x.com/2/${path}`, { headers: { authorization: `Bearer ${this.token}` } });
    } catch {
      throw new PlatformUnavailableError("X", "X API unreachable");
    }
    if ([401, 402, 403, 429].includes(res.status)) throw new PlatformUnavailableError("X", `X API access denied or rate limited (${res.status})`);
    if (res.status === 404) throw new Error("Post not found or not public");
    if (!res.ok) throw new PlatformUnavailableError("X", `X API failed (${res.status})`);
    return (await res.json()) as T;
  }

  async checkChannelCode(handle: string, code: string) {
    try {
      const r = await this.api<{ data?: { id: string; description?: string } }>(
        `users/by/username/${encodeURIComponent(normalizeXHandle(handle))}?user.fields=description`,
      );
      if (!r.data) return { ok: false, reason: "X account not found" };
      if (!(r.data.description ?? "").includes(code)) return { ok: false, reason: "Code not found in X bio" };
      return { ok: true, externalId: r.data.id };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "X lookup failed", unavailable: e instanceof PlatformUnavailableError };
    }
  }

  async fetchVideo(link: string): Promise<VideoInfo> {
    const videoId = parseXPostId(link);
    if (!videoId) throw new Error("Not a valid X post link");
    const r = await this.api<{
      data?: { text: string; author_id: string; created_at?: string; public_metrics?: { impression_count?: number } };
      includes?: { users?: { id: string; username: string }[]; media?: { type: string; public_metrics?: { view_count?: number } }[] };
    }>(
      `tweets/${videoId}?tweet.fields=public_metrics,author_id,created_at&expansions=author_id,attachments.media_keys&user.fields=username&media.fields=type,public_metrics`,
    );
    const d = r.data;
    if (!d) throw new Error("Post not found or not public");
    const author = r.includes?.users?.find((u) => u.id === d.author_id);
    const views =
      r.includes?.media?.find((m) => m.public_metrics?.view_count != null)?.public_metrics?.view_count ?? d.public_metrics?.impression_count ?? 0;
    return {
      videoId,
      channelHandle: author ? normalizeXHandle(author.username) : null,
      channelExternalId: d.author_id,
      title: d.text.slice(0, 80),
      description: d.text,
      transcript: null,
      views,
      publishedAt: d.created_at ?? null,
    };
  }

  async getViews(postId: string) {
    const r = await this.api<{
      data?: { public_metrics?: { impression_count?: number } };
      includes?: { media?: { public_metrics?: { view_count?: number } }[] };
    }>(`tweets/${postId}?tweet.fields=public_metrics&expansions=attachments.media_keys&media.fields=public_metrics`);
    const v = r.includes?.media?.find((m) => m.public_metrics?.view_count != null)?.public_metrics?.view_count ?? r.data?.public_metrics?.impression_count;
    if (v == null) throw new PlatformUnavailableError("X", "X did not return a public view count for this post");
    return v;
  }
}

export function getX(): PlatformClient {
  return getOverride<PlatformClient>("x") ?? new RealX(requireEnv("X API v2", "X_BEARER_TOKEN"));
}
