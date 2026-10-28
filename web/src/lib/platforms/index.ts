import { getYouTube, normalizeHandle as ytNormalize, parseVideoId as ytParse } from "../youtube";
import { getInstagram, isValidInstagramHandle, normalizeInstagramHandle, parseInstagramShortcode } from "./instagram";
import { PlatformUnavailableError, type PlatformAdapter, type PlatformName, type VideoInfo } from "./types";
import { getX, isValidXHandle, normalizeXHandle, parseXPostId } from "./x";

export * from "./types";

const adapters: Record<PlatformName, PlatformAdapter> = {
  YOUTUBE: {
    platform: "YOUTUBE",
    parseVideoId: ytParse,
    normalizeHandle: ytNormalize,
    isValidHandle: (h) => /^[\w.-]{2,100}$/.test(ytNormalize(h)),
    client: getYouTube,
  },
  X: { platform: "X", parseVideoId: parseXPostId, normalizeHandle: normalizeXHandle, isValidHandle: isValidXHandle, client: getX },
  INSTAGRAM: {
    platform: "INSTAGRAM",
    parseVideoId: parseInstagramShortcode,
    normalizeHandle: normalizeInstagramHandle,
    isValidHandle: isValidInstagramHandle,
    client: getInstagram,
  },
};

export const PLATFORM_NAMES = Object.keys(adapters) as PlatformName[];

export function getPlatform(p: PlatformName | string): PlatformAdapter {
  const a = adapters[p as PlatformName];
  if (!a) throw new Error(`Unsupported platform: ${p}`);
  return a;
}

export type FetchOutcome = { readable: true; video: VideoInfo } | { readable: false; reason: string };

/**
 * Fetch clip content/metadata. A clip that cannot be read automatically yields `readable: false`
 * (caller creates a NEEDS_HUMAN verdict). Genuine "not found / not public" errors still throw.
 */
export async function fetchClip(platform: PlatformName, link: string, hint?: { channelHandle?: string; channelId?: string }): Promise<FetchOutcome> {
  try {
    return { readable: true, video: await getPlatform(platform).client().fetchVideo(link, hint) };
  } catch (e) {
    if (e instanceof PlatformUnavailableError) return { readable: false, reason: e.message };
    throw e; // incl. ApiError 503 NOT_CONFIGURED: never downgraded to "unreadable"
  }
}
