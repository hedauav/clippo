import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { getOverride, requireEnv } from "../config";
import { decryptSecret, encryptSecret } from "../secrets";
import { PlatformUnavailableError, type PlatformClient, type VideoInfo } from "./types";

export const normalizeInstagramHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();
export const isValidInstagramHandle = (h: string) => /^[a-z0-9._]{1,30}$/.test(normalizeInstagramHandle(h));

/** Accepts instagram.com /reel/, /reels/, /p/, /tv/ links; returns the shortcode. */
export function parseInstagramShortcode(link: string): string | null {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "instagram.com" && host !== "instagr.am") return null;
    const m = u.pathname.match(/^\/(?:[A-Za-z0-9_.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,20})(?:\/|$)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/* ---------- Creator OAuth (Instagram API with Instagram Login) ---------- */
const SCOPES = "instagram_business_basic,instagram_business_manage_insights";
const GRAPH = "https://graph.instagram.com";

export const instagramOAuthConfig = () => ({
  appId: requireEnv("Instagram OAuth", "INSTAGRAM_APP_ID"),
  appSecret: requireEnv("Instagram OAuth", "INSTAGRAM_APP_SECRET"),
  redirectUri: requireEnv("Instagram OAuth", "INSTAGRAM_REDIRECT_URI"),
});

const signState = (payload: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "dev-insecure-secret").update(`ig|${payload}`).digest("base64url");

export function makeOAuthState(channelId: string, userId: string): string {
  const p = Buffer.from(JSON.stringify({ c: channelId, u: userId, exp: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${p}.${signState(p)}`;
}

export function readOAuthState(state: string): { channelId: string; userId: string } | null {
  const [p, sig] = state.split(".");
  if (!p || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(signState(p));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const j = JSON.parse(Buffer.from(p, "base64url").toString()) as { c: string; u: string; exp: number };
  return j.exp > Date.now() ? { channelId: j.c, userId: j.u } : null;
}

export function instagramAuthorizeUrl(state: string): string {
  const c = instagramOAuthConfig();
  const q = new URLSearchParams({ client_id: c.appId, redirect_uri: c.redirectUri, response_type: "code", scope: SCOPES, state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

/** Exchanges the code for a long-lived token and the account identity. */
export async function exchangeInstagramCode(code: string): Promise<{ token: string; expiresAt: Date; igUserId: string; username: string }> {
  const c = instagramOAuthConfig();
  const short = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({ client_id: c.appId, client_secret: c.appSecret, grant_type: "authorization_code", redirect_uri: c.redirectUri, code }),
  });
  if (!short.ok) throw new Error(`Instagram code exchange failed (${short.status})`);
  const s = (await short.json()) as { access_token: string };
  const long = await fetch(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: c.appSecret, access_token: s.access_token })}`);
  if (!long.ok) throw new Error(`Instagram long-lived token exchange failed (${long.status})`);
  const l = (await long.json()) as { access_token: string; expires_in: number };
  const me = await fetch(`${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username", access_token: l.access_token })}`);
  if (!me.ok) throw new Error(`Instagram profile read failed (${me.status})`);
  const m = (await me.json()) as { user_id?: string; id?: string; username: string };
  return { token: l.access_token, expiresAt: new Date(Date.now() + l.expires_in * 1000), igUserId: String(m.user_id ?? m.id), username: m.username };
}

export const storeInstagramToken = (channelId: string, token: string, expiresAt: Date) =>
  db.channel.update({ where: { id: channelId }, data: { accessTokenEnc: encryptSecret(token), tokenExpiresAt: expiresAt } });

async function channelToken(channelId: string | undefined, handle?: string): Promise<{ token: string; channelId: string } | null> {
  const ch = channelId
    ? await db.channel.findUnique({ where: { id: channelId } })
    : handle
      ? await db.channel.findUnique({ where: { platform_handle: { platform: "INSTAGRAM", handle: normalizeInstagramHandle(handle) } } })
      : null;
  if (!ch?.accessTokenEnc) return null;
  if (ch.tokenExpiresAt && ch.tokenExpiresAt < new Date()) throw new PlatformUnavailableError("INSTAGRAM", "Instagram connection expired; the creator must reconnect");
  return { token: decryptSecret(ch.accessTokenEnc), channelId: ch.id };
}

interface Media {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
  media_type?: string;
}

/**
 * Real Instagram client using each creator's OWN OAuth token (Instagram API with Instagram Login, Business/Creator accounts).
 * Reads the post via /me/media and its views via /{media-id}/insights?metric=views. Instagram exposes no spoken audio, so
 * `transcript` is null and every Instagram clip goes to human review. A channel with no (or an expired) token raises
 * PlatformUnavailableError -> human review, never a silent skip.
 */
export class RealInstagram implements PlatformClient {
  readonly mode = "real" as const;

  async checkChannelCode(handle: string) {
    const t = await channelToken(undefined, handle).catch(() => null);
    if (!t) return { ok: false, reason: "Connect this Instagram account with the Connect Instagram (OAuth) flow to verify ownership" };
    return { ok: true };
  }

  private async media(token: string, shortcode: string): Promise<Media | undefined> {
    let url: string | null = `${GRAPH}/me/media?${new URLSearchParams({ fields: "id,caption,permalink,timestamp,media_type", limit: "50", access_token: token })}`;
    for (let page = 0; page < 6 && url; page++) {
      const res: Response = await fetch(url);
      if ([400, 401, 403, 429].includes(res.status)) throw new PlatformUnavailableError("INSTAGRAM", `Instagram API access denied (${res.status})`);
      if (!res.ok) throw new PlatformUnavailableError("INSTAGRAM", `Instagram API failed (${res.status})`);
      const j = (await res.json()) as { data: Media[]; paging?: { next?: string } };
      const hit = j.data.find((m) => m.permalink?.includes(`/${shortcode}`));
      if (hit) return hit;
      url = j.paging?.next ?? null;
    }
    return undefined;
  }

  private async views(token: string, mediaId: string): Promise<number> {
    const res = await fetch(`${GRAPH}/${mediaId}/insights?${new URLSearchParams({ metric: "views", access_token: token })}`);
    if (!res.ok) throw new PlatformUnavailableError("INSTAGRAM", `Instagram insights unavailable (${res.status})`);
    const j = (await res.json()) as { data?: { values?: { value: number }[]; total_value?: { value: number } }[] };
    const v = j.data?.[0]?.total_value?.value ?? j.data?.[0]?.values?.[0]?.value;
    if (v == null) throw new PlatformUnavailableError("INSTAGRAM", "Instagram returned no view count for this post");
    return v;
  }

  async fetchVideo(link: string, hint?: { channelHandle?: string; channelId?: string }): Promise<VideoInfo> {
    const videoId = parseInstagramShortcode(link);
    if (!videoId) throw new Error("Not a valid Instagram post or reel link");
    const t = await channelToken(hint?.channelId, hint?.channelHandle);
    if (!t) throw new PlatformUnavailableError("INSTAGRAM", "The creator has not connected Instagram (OAuth)");
    const m = await this.media(t.token, videoId);
    if (!m) throw new PlatformUnavailableError("INSTAGRAM", "Post not found among the connected account's media");
    const ch = await db.channel.findUnique({ where: { id: t.channelId } });
    let views = 0;
    try {
      views = await this.views(t.token, m.id);
    } catch {
      /* views are read again by the snapshot job */
    }
    return {
      videoId,
      channelHandle: ch?.handle ?? null,
      channelExternalId: ch?.externalId ?? null,
      title: (m.caption ?? "").slice(0, 80),
      description: m.caption ?? "",
      transcript: null,
      views,
      publishedAt: m.timestamp ?? null,
    };
  }

  async getViews(shortcode: string, ctx?: { channelId?: string }): Promise<number> {
    const t = await channelToken(ctx?.channelId);
    if (!t) throw new PlatformUnavailableError("INSTAGRAM", "The creator has not connected Instagram (OAuth)");
    const m = await this.media(t.token, shortcode);
    if (!m) throw new PlatformUnavailableError("INSTAGRAM", "Post not found among the connected account's media");
    return this.views(t.token, m.id);
  }
}

export function getInstagram(): PlatformClient {
  return getOverride<PlatformClient>("instagram") ?? new RealInstagram();
}
