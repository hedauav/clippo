import type { VideoJob } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeVideoGenerator, PLACEHOLDER_MP4 } from "../../test/doubles";
import { sniffVideoMime } from "../storage/files";
import { GeminiVideoGenerator, getVideoGenerator, registerVideoGenerator, type VideoGenerator } from "./index";
import { jobIdFromUrl, jobView } from "./jobs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("test double (src/test/doubles.ts)", () => {
  it("goes queued -> running -> succeeded", async () => {
    const g = new FakeVideoGenerator(1000);
    const { providerJobId } = await g.start("a product demo");
    expect((await g.poll(providerJobId)).status).toBe("QUEUED");
    expect((await g.poll(`fake-${Date.now() - 500}-ok`)).status).toBe("RUNNING");
    const done = await g.poll(`fake-${Date.now() - 5000}-ok`);
    expect(done.status).toBe("SUCCEEDED");
    expect(sniffVideoMime(done.output!.data)).toBe("video/mp4");
    expect(done.output!.data).toBe(PLACEHOLDER_MP4);
  });
});

describe("real provider selection fails loudly", () => {
  it("503 NOT_CONFIGURED without GEMINI_API_KEY (no silent mock)", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("VIDEO_GEN_PROVIDER", "");
    expect(() => getVideoGenerator()).toThrowError(/not configured: set GEMINI_API_KEY/);
  });
  it("http provider needs VIDEO_GEN_URL; providers are pluggable", () => {
    vi.stubEnv("VIDEO_GEN_PROVIDER", "http");
    vi.stubEnv("VIDEO_GEN_URL", "");
    expect(() => getVideoGenerator()).toThrowError(/VIDEO_GEN_URL/);
    const custom: VideoGenerator = { name: "custom", mode: "real", start: async () => ({ providerJobId: "x" }), poll: async () => ({ status: "RUNNING", progress: 1 }) };
    registerVideoGenerator("custom", () => custom);
    vi.stubEnv("VIDEO_GEN_PROVIDER", "custom");
    expect(getVideoGenerator().name).toBe("custom");
  });
});

describe("GeminiVideoGenerator (Interactions API, stubbed network)", () => {
  it("starts a background interaction with the api key header, polls, and decodes the base64 video", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "POST") return Response.json({ id: "v1_abc", status: "in_progress" });
        const n = calls.filter((c) => c.init?.method !== "POST").length;
        if (n === 1) return Response.json({ id: "v1_abc", status: "in_progress" });
        return Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: Buffer.from(PLACEHOLDER_MP4).toString("base64") }] }] });
      }),
    );
    const g = new GeminiVideoGenerator("KEY", "gemini-omni-1.1-flash");
    expect(await g.start("a demo")).toEqual({ providerJobId: "v1_abc" });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect((calls[0].init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
    expect(JSON.parse(calls[0].init!.body as string)).toMatchObject({ model: "gemini-omni-1.1-flash", input: "a demo", background: true });
    expect((await g.poll("v1_abc")).status).toBe("RUNNING");
    const done = await g.poll("v1_abc");
    expect(done.status).toBe("SUCCEEDED");
    expect(Array.from(done.output!.data)).toEqual(Array.from(PLACEHOLDER_MP4));
  });
  it("reports failure and missing output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "failed", error: { message: "blocked" } })));
    expect(await new GeminiVideoGenerator("K").poll("x")).toMatchObject({ status: "FAILED", error: "blocked" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "completed", steps: [] })));
    expect((await new GeminiVideoGenerator("K").poll("x")).status).toBe("FAILED");
  });
});

describe("jobView", () => {
  const base = {
    id: "j1",
    campaignId: null,
    requestedById: "u",
    prompt: "p",
    provider: "mock",
    providerJobId: "m",
    status: "QUEUED",
    error: null,
    outputAssetId: null,
    aiGenerated: true,
    rightsConfirmed: true,
    approvalStatus: "PENDING",
    approvedById: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as VideoJob;
  it("always labels output AI-generated and only exposes a url once rendered", () => {
    expect(jobView(base)).toMatchObject({ status: "queued", label: "AI-GENERATED", aiGenerated: true, videoUrl: null });
    expect(jobView({ ...base, status: "RUNNING" }, 40)).toMatchObject({ status: "rendering", progress: 40 });
    const ready = jobView({ ...base, status: "SUCCEEDED", outputAssetId: "a1" });
    expect(ready).toMatchObject({ status: "ready", videoUrl: "/api/ai-video/jobs/j1/video", label: "AI-GENERATED" });
    expect(jobView({ ...base, status: "SUCCEEDED", outputAssetId: "a1", approvalStatus: "APPROVED" }).status).toBe("approved");
    expect(jobView({ ...base, status: "FAILED", error: "x" })).toMatchObject({ status: "failed", error: "x" });
  });
  it("extracts job id from a campaign contentUrl", () => {
    expect(jobIdFromUrl("/api/ai-video/jobs/abc123/video")).toBe("abc123");
    expect(jobIdFromUrl("https://example.com")).toBeNull();
    expect(jobIdFromUrl(null)).toBeNull();
  });
});
