import type { VideoInfo, YouTubeClient } from "../youtube";

export type { VideoInfo };
export type PlatformName = "YOUTUBE" | "X" | "INSTAGRAM";

/** Same contract as the YouTube client, so every platform plugs into the verifier and snapshot job unchanged. */
export type PlatformClient = YouTubeClient;

/**
 * Thrown when a clip/channel cannot be read automatically (missing API access, private post, rate limit,
 * platform does not expose the data). Callers MUST route the clip to human review; never skip or auto-approve.
 */
export class PlatformUnavailableError extends Error {
  constructor(
    public platform: PlatformName,
    message: string,
  ) {
    super(message);
    this.name = "PlatformUnavailableError";
  }
}

export interface PlatformAdapter {
  readonly platform: PlatformName;
  parseVideoId(link: string): string | null;
  normalizeHandle(handle: string): string;
  isValidHandle(handle: string): boolean;
  client(): PlatformClient;
}
