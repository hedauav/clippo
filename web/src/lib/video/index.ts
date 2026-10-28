/**
 * AI source-video generation (Google Gemini API: Gemini Omni / Veo family, polled until done, output stored by jobs.ts).
 * Provider is selected by VIDEO_GEN_PROVIDER: "gemini" (default; needs GEMINI_API_KEY) or "http" (generic service at VIDEO_GEN_URL).
 * Nothing is faked: a missing key is a 503 NOT_CONFIGURED. Whatever a provider returns is ALWAYS stored and served as AI-generated.
 */
import { getOverride, requireEnv } from "../config";

export type VideoJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface VideoPoll {
  status: VideoJobStatus;
  /** 0..100 */
  progress: number;
  output?: { data: Uint8Array; mime: string };
  error?: string;
}

export interface VideoGenerator {
  readonly name: string;
  readonly mode: string;
  start(prompt: string): Promise<{ providerJobId: string }>;
  poll(providerJobId: string): Promise<VideoPoll>;
}

/**
 * Gemini API video generation via the Interactions API (POST /v1beta/interactions, background=true; poll
 * GET /v1beta/interactions/{id}). Model from GEMINI_VIDEO_MODEL (default gemini-omni-1.1-flash; the Veo 3.1 preview
 * models were shut down 2026-10-22). The finished video arrives as base64 in steps[].content[] (type "video").
 */
export class GeminiVideoGenerator implements VideoGenerator {
  readonly name = "gemini";
  readonly mode = "real" as const;
  private base = "https://generativelanguage.googleapis.com/v1beta";
  constructor(
    private key: string,
    private model = process.env.GEMINI_VIDEO_MODEL || "gemini-omni-1.1-flash",
  ) {}

  private headers() {
    return { "content-type": "application/json", "x-goog-api-key": this.key };
  }

  async start(prompt: string) {
    const res = await fetch(`${this.base}/interactions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.model, input: prompt, background: true, store: true }),
    });
    if (!res.ok) throw new Error(`Gemini rejected the video job (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { id?: string };
    if (!j.id) throw new Error("Gemini returned no interaction id");
    return { providerJobId: j.id };
  }

  async poll(id: string): Promise<VideoPoll> {
    const res = await fetch(`${this.base}/interactions/${encodeURIComponent(id)}`, { headers: this.headers() });
    if (!res.ok) return { status: "FAILED", progress: 0, error: `Gemini status failed (${res.status})` };
    const j = (await res.json()) as {
      status?: string;
      error?: { message?: string };
      steps?: { type?: string; content?: { type?: string; mime_type?: string; data?: string; uri?: string }[] }[];
    };
    const st = String(j.status ?? "").toLowerCase();
    if (st === "failed" || st === "cancelled" || st === "incomplete") return { status: "FAILED", progress: 0, error: j.error?.message ?? `Gemini job ${st}` };
    if (st === "completed") {
      const v = j.steps?.flatMap((s) => s.content ?? []).find((c) => c.type === "video");
      if (!v) return { status: "FAILED", progress: 0, error: "Gemini finished without a video output" };
      const max = Number(process.env.VIDEO_GEN_MAX_BYTES) || 200 * 1024 * 1024;
      let data: Uint8Array;
      if (v.data) data = new Uint8Array(Buffer.from(v.data, "base64"));
      else if (v.uri && v.uri.startsWith("https://generativelanguage.googleapis.com/")) {
        const d = await fetch(v.uri, { headers: { "x-goog-api-key": this.key }, redirect: "follow" });
        if (!d.ok) return { status: "FAILED", progress: 0, error: `Could not download generated video (${d.status})` };
        data = new Uint8Array(await d.arrayBuffer());
      } else return { status: "FAILED", progress: 0, error: "Gemini video output had no data" };
      if (data.length > max) return { status: "FAILED", progress: 0, error: "Generated video exceeds the size limit" };
      return { status: "SUCCEEDED", progress: 100, output: { data, mime: v.mime_type || "video/mp4" } };
    }
    return { status: st === "in_progress" || st === "running" ? "RUNNING" : "QUEUED", progress: st === "in_progress" ? 50 : 5 };
  }
}

/**
 * Generic HTTP provider contract:
 *   POST {url}/jobs        {prompt}                 -> {id}
 *   GET  {url}/jobs/{id}                            -> {status: queued|running|succeeded|failed, progress?, videoUrl?, error?}
 * `videoUrl` must be https and at most VIDEO_GEN_MAX_BYTES (default 200 MB).
 */
export class HttpVideoGenerator implements VideoGenerator {
  readonly name = "http";
  readonly mode = "real" as const;
  constructor(
    private baseUrl: string,
    private key?: string,
  ) {}

  private headers() {
    return { "content-type": "application/json", ...(this.key ? { authorization: `Bearer ${this.key}` } : {}) };
  }

  async start(prompt: string) {
    const res = await fetch(`${this.baseUrl}/jobs`, { method: "POST", headers: this.headers(), body: JSON.stringify({ prompt }) });
    if (!res.ok) throw new Error(`Video provider rejected the job (${res.status})`);
    const j = (await res.json()) as { id?: string };
    if (!j.id) throw new Error("Video provider returned no job id");
    return { providerJobId: String(j.id) };
  }

  async poll(id: string): Promise<VideoPoll> {
    const res = await fetch(`${this.baseUrl}/jobs/${encodeURIComponent(id)}`, { headers: this.headers() });
    if (!res.ok) return { status: "FAILED", progress: 0, error: `Video provider status failed (${res.status})` };
    const j = (await res.json()) as { status?: string; progress?: number; videoUrl?: string; error?: string };
    const s = String(j.status ?? "").toLowerCase();
    if (s === "failed") return { status: "FAILED", progress: 0, error: j.error ?? "Provider reported failure" };
    if (s === "succeeded" && j.videoUrl) {
      const url = new URL(j.videoUrl);
      if (url.protocol !== "https:") return { status: "FAILED", progress: 0, error: "Provider returned a non-https video URL" };
      const max = Number(process.env.VIDEO_GEN_MAX_BYTES) || 200 * 1024 * 1024;
      const v = await fetch(url);
      if (!v.ok) return { status: "FAILED", progress: 0, error: `Could not download generated video (${v.status})` };
      const data = new Uint8Array(await v.arrayBuffer());
      if (data.length > max) return { status: "FAILED", progress: 0, error: "Generated video exceeds the size limit" };
      return { status: "SUCCEEDED", progress: 100, output: { data, mime: v.headers.get("content-type")?.split(";")[0] || "video/mp4" } };
    }
    return { status: s === "running" ? "RUNNING" : "QUEUED", progress: Math.max(0, Math.min(99, Number(j.progress) || 0)) };
  }
}

const registry = new Map<string, () => VideoGenerator>();
/** Plug in another provider (e.g. in a bootstrap module) and select it with VIDEO_GEN_PROVIDER=<name>. */
export const registerVideoGenerator = (name: string, factory: () => VideoGenerator) => void registry.set(name, factory);

export function getVideoGenerator(): VideoGenerator {
  const o = getOverride<VideoGenerator>("videoGenerator");
  if (o) return o;
  const wanted = process.env.VIDEO_GEN_PROVIDER || "gemini";
  if (registry.has(wanted)) return registry.get(wanted)!();
  if (wanted === "http") return new HttpVideoGenerator(requireEnv("HTTP video provider", "VIDEO_GEN_URL").replace(/\/$/, ""), process.env.VIDEO_GEN_KEY);
  if (wanted === "gemini") return new GeminiVideoGenerator(requireEnv("Gemini video generation", "GEMINI_API_KEY"));
  throw new Error(`Unknown VIDEO_GEN_PROVIDER "${wanted}" (use gemini or http)`);
}
