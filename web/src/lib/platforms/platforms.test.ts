import { afterEach, describe, expect, it, vi } from "vitest";
import { FakePlatform, HeuristicLlm } from "../../test/doubles";
import { verifyClip } from "../ai/verifier";
import { fetchClip, getPlatform, PlatformUnavailableError } from "./index";
import { getInstagram, parseInstagramShortcode } from "./instagram";
import { getX, RealX, parseXPostId, xHandleFromLink } from "./x";
import { getYouTube } from "../youtube";

const MockX = class extends FakePlatform {
  constructor() {
    super("X", parseXPostId);
  }
};
const MockInstagram = class extends FakePlatform {
  constructor() {
    super("INSTAGRAM", parseInstagramShortcode);
  }
};

afterEach(() => vi.unstubAllGlobals());

describe("link parsing", () => {
  it("parses X/Twitter status links", () => {
    expect(parseXPostId("https://x.com/alice/status/1234567890123")).toBe("1234567890123");
    expect(parseXPostId("https://twitter.com/alice/status/42?s=20")).toBe("42");
    expect(parseXPostId("https://mobile.twitter.com/a_b/status/7/video/1")).toBe("7");
    expect(parseXPostId("https://x.com/alice")).toBeNull();
    expect(parseXPostId("https://evil.com/alice/status/1")).toBeNull();
    expect(xHandleFromLink("https://x.com/Alice/status/1")).toBe("alice");
  });
  it("parses Instagram reel/post links", () => {
    expect(parseInstagramShortcode("https://www.instagram.com/reel/Cx1_ab-Zk9/")).toBe("Cx1_ab-Zk9");
    expect(parseInstagramShortcode("https://instagram.com/p/ABCDE12345/?igsh=x")).toBe("ABCDE12345");
    expect(parseInstagramShortcode("https://instagram.com/someone/reel/ABCDE12345/")).toBe("ABCDE12345");
    expect(parseInstagramShortcode("https://instagram.com/someone")).toBeNull();
    expect(parseInstagramShortcode("https://youtube.com/watch?v=abc")).toBeNull();
  });
  it("registry routes by platform and keeps YouTube working", () => {
    expect(getPlatform("YOUTUBE").parseVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(getPlatform("X").parseVideoId("https://x.com/a/status/9")).toBe("9");
    expect(getPlatform("INSTAGRAM").parseVideoId("https://instagram.com/reel/ABCDE12345/")).toBe("ABCDE12345");
    expect(getPlatform("X").normalizeHandle("@Alice")).toBe("alice");
    expect(getPlatform("X").isValidHandle("this_handle_is_way_too_long")).toBe(false);
    expect(getPlatform("INSTAGRAM").isValidHandle("a.b_c")).toBe(true);
    expect(() => getPlatform("TIKTOK")).toThrow();
  });
});

describe("no mock fallbacks: missing credentials fail loudly", () => {
  it("each real adapter throws 503 NOT_CONFIGURED naming the env var", () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    vi.stubEnv("YOUTUBE_API_KEY", "");
    expect(() => getX()).toThrowError(/not configured: set X_BEARER_TOKEN/);
    expect(() => getYouTube()).toThrowError(/not configured: set YOUTUBE_API_KEY/);
    expect(getInstagram().mode).toBe("real"); // per-creator OAuth tokens live on the channel, not in env
  });
});

describe("test-double adapters", () => {
  it("X: bio code, content, views", async () => {
    const x = new MockX();
    expect((await x.checkChannelCode("alice")).ok).toBe(true);
    expect((await x.checkChannelCode("failer")).ok).toBe(false);
    const v = await x.fetchVideo("https://x.com/alice/status/123", { channelHandle: "alice" });
    expect(v.channelHandle).toBe("alice");
    expect(v.transcript).toMatch(/Sponsored/);
    expect(v.views).toBeGreaterThan(0);
    expect((await x.fetchVideo("https://x.com/alice/status/120")).transcript).toBeNull();
  });
  it("Instagram: unreadable and stolen cases", async () => {
    const ig = new MockInstagram();
    expect((await ig.fetchVideo("https://instagram.com/reel/nocaps12345/", { channelHandle: "a" })).transcript).toBeNull();
    expect((await ig.fetchVideo("https://instagram.com/reel/stolen12345/", { channelHandle: "a" })).channelHandle).toBe("someone-else");
  });
});

describe("unreadable clips go to human review, never auto-approved", () => {
  const story = { summary: "s", topic: "product", requiredPoints: ["product"], prohibitedClaims: [], disclosureLabel: "sponsored", attribution: "" };
  it("a null transcript from X/IG yields NEEDS_HUMAN through the verifier", async () => {
    const v = await new MockX().fetchVideo("https://x.com/alice/status/120", { channelHandle: "alice" });
    const r = await verifyClip({ story, transcript: v.transcript, title: v.title, description: v.description, channelOwned: true, existing: [] }, new HeuristicLlm());
    expect(r.result).toBe("NEEDS_HUMAN");
    expect(r.flags).toContain("unreadable");
  });
  it("real X without access raises PlatformUnavailableError, which fetchClip turns into readable:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    await expect(new RealX("t").fetchVideo("https://x.com/a/status/5")).rejects.toBeInstanceOf(PlatformUnavailableError);
    const real = new RealX("t");
    expect(await real.checkChannelCode("a", "code")).toMatchObject({ ok: false, unavailable: true });
    await expect(real.getViews("5")).rejects.toBeInstanceOf(PlatformUnavailableError);
  });
  it("real X reads bio, post, views", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("users/by/username")) return Response.json({ data: { id: "99", description: "hello clippo-abc123" } });
        return Response.json({
          data: { text: "post text", author_id: "99", created_at: "2026-01-01T00:00:00Z", public_metrics: { impression_count: 5 } },
          includes: { users: [{ id: "99", username: "Alice" }], media: [{ type: "video", public_metrics: { view_count: 1234 } }] },
        });
      }),
    );
    const x = new RealX("t");
    expect(await x.checkChannelCode("alice", "clippo-abc123")).toEqual({ ok: true, externalId: "99" });
    expect((await x.checkChannelCode("alice", "nope")).ok).toBe(false);
    const v = await x.fetchVideo("https://x.com/alice/status/55");
    expect(v).toMatchObject({ channelHandle: "alice", channelExternalId: "99", views: 1234, transcript: null, description: "post text" });
    expect(await x.getViews("55")).toBe(1234);
  });
  it("real Instagram without a connected account routes to human review", async () => {
    const { RealInstagram } = await import("./instagram");
    const ig = new RealInstagram();
    expect((await ig.checkChannelCode("nobody-connected")).ok).toBe(false);
    await expect(ig.fetchVideo("https://instagram.com/reel/ABCDE12345/", { channelHandle: "nobody-connected" })).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(ig.getViews("ABCDE12345", { channelId: "missing" })).rejects.toBeInstanceOf(PlatformUnavailableError);
  });
  it("fetchClip maps unavailability and rethrows real errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    vi.stubEnv("X_BEARER_TOKEN", "tok");
    const out = await fetchClip("X", "https://x.com/a/status/5");
    expect(out.readable).toBe(false);
    await expect(fetchClip("X", "https://x.com/nothing")).rejects.toThrow();
    vi.unstubAllEnvs();
  });
});
