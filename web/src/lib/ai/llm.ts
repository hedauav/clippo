import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getOverride } from "../config";
import { ApiError } from "../http";

/* ------------------------------------------------------------------------------------------------
 * Public interface (UNCHANGED for callers): getLlm() -> LlmClient.complete({system,user,task,maxTokens}) -> raw JSON text.
 * Everything below is additive: a provider switch (Anthropic | Gemini) plus free-tier robustness
 * (retry/backoff, concurrency + per-minute throttle, identical-request cache, input truncation, clear quota errors).
 * Callers keep validating the returned text with zod and fall back / NEEDS_HUMAN when it is malformed.
 * ---------------------------------------------------------------------------------------------- */

export type LlmTask = "verify" | "write" | "assist" | "propose";

export interface LlmRequest {
  system: string;
  user: string;
  task: LlmTask;
  maxTokens?: number;
  /** Optional JSON Schema; the Gemini provider enforces it natively (response_format). Callers still validate with zod. */
  jsonSchema?: Record<string, unknown>;
  /** Total wall-clock budget for this call incl. queueing and retries; retries that cannot fit are not attempted. */
  timeoutMs?: number;
}

export interface LlmClient {
  readonly mode: string;
  /** Provider name when known ("anthropic" | "gemini"). */
  readonly provider?: string;
  /** Model id when known. */
  readonly model?: string;
  /** Returns the raw text completion (expected to be a JSON object). */
  complete(req: LlmRequest): Promise<string>;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";
/** Stable, free-tier, fast model with structured output support: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export type LlmProviderName = "anthropic" | "gemini";

/* ---------------- errors ---------------- */

/** Error raised by a provider transport; the resilience layer decides whether to retry. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    /** Server-suggested wait (Retry-After header or Gemini RetryInfo.retryDelay). */
    public retryAfterMs?: number,
    /** Quota that will not recover within a minute (e.g. requests-per-day); never retried. */
    public exhausted = false,
  ) {
    super(message);
  }
}

export const AI_QUOTA_CODE = "AI_QUOTA_EXCEEDED";
export const isQuotaError = (e: unknown): e is ApiError => e instanceof ApiError && e.code === AI_QUOTA_CODE;

const quotaError = () => new ApiError(429, AI_QUOTA_CODE, "AI quota exceeded, try again in a minute (free-tier request limits were reached)");

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof LlmProviderError) {
    if (e.status === 429) return quotaError();
    if (e.status === 503 || e.status === 500 || e.status === 502 || e.status === 504 || e.status === undefined)
      return new ApiError(503, "AI_UNAVAILABLE", "The AI provider is temporarily unavailable, try again shortly");
    if (e.status === 401 || e.status === 403) return new ApiError(503, "AI_AUTH", "The AI provider rejected the configured API key");
    return new ApiError(502, "AI_PROVIDER_ERROR", `The AI provider could not process the request (${e.status})`);
  }
  return new ApiError(503, "AI_UNAVAILABLE", "The AI provider is temporarily unavailable, try again shortly");
}

/* ---------------- transports ---------------- */

export interface LlmTransport {
  readonly provider: LlmProviderName;
  readonly model: string;
  readonly mode: string;
  send(req: LlmRequest): Promise<string>;
}

function parseRetryAfter(v: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : undefined;
}

export class AnthropicLlm implements LlmClient, LlmTransport {
  readonly mode = "real" as const;
  readonly provider = "anthropic" as const;
  private client: Anthropic;
  constructor(
    apiKey: string,
    readonly model = DEFAULT_MODEL,
  ) {
    // Retries/backoff live in the shared resilience layer, so the SDK's own retries are disabled.
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }
  async send(req: LlmRequest): Promise<string> {
    try {
      return await this.complete(req);
    } catch (e) {
      const x = e as { status?: number; headers?: { get?: (k: string) => string | null } | Record<string, string>; message?: string };
      if (typeof x?.status === "number") {
        const h = x.headers as { get?: (k: string) => string | null } | undefined;
        const ra = typeof h?.get === "function" ? h.get("retry-after") : (x.headers as Record<string, string> | undefined)?.["retry-after"];
        throw new LlmProviderError(x.message ?? "Anthropic error", x.status, parseRetryAfter(ra));
      }
      throw new LlmProviderError(x?.message ?? "Anthropic network error");
    }
  }
  async complete(req: LlmRequest): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    return res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  }
}

/** JSON Schema for the split proposer (task "propose"); software re-checks every number regardless. */
export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    splits: {
      type: "array",
      items: {
        type: "object",
        properties: { creator: { type: "string" }, amountMicroUsdc: { type: "integer" }, reason: { type: "string" } },
        required: ["creator", "amountMicroUsdc", "reason"],
      },
    },
    rationale: { type: "string" },
    confidence: { type: "number" },
    flags: { type: "array", items: { type: "string" } },
  },
  required: ["splits", "rationale", "confidence", "flags"],
} as const;

/** JSON Schema for the verifier verdict (enforced natively by Gemini; zod in verifier.ts still validates). */
export const VERDICT_JSON_SCHEMA = {
  type: "object",
  properties: {
    result: { type: "string", enum: ["APPROVE", "REJECT", "NEEDS_HUMAN"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["result", "confidence", "reason"],
} as const;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(k: string): string | null };
  text(): Promise<string>;
}>;

/**
 * Gemini API text generation via the Interactions API (the same endpoint family the video generator uses):
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions, header x-goog-api-key.
 * system_instruction carries OUR system prompt (identical text to Anthropic's `system`); the user message carries the
 * delimited untrusted data exactly as for Claude. Plain fetch (no SDK dependency).
 * Docs: https://ai.google.dev/gemini-api/docs/text-generation, .../structured-output, .../safety-settings
 */
export class GeminiLlm implements LlmTransport {
  readonly mode = "real" as const;
  readonly provider = "gemini" as const;
  private base = "https://generativelanguage.googleapis.com/v1beta";
  constructor(
    private apiKey: string,
    readonly model = DEFAULT_GEMINI_MODEL,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || 30_000,
  ) {}

  async send(req: LlmRequest): Promise<string> {
    const generation_config: Record<string, unknown> = {
      // Thinking tokens count toward the output cap, so leave headroom above the caller's visible-output budget.
      max_output_tokens: (req.maxTokens ?? 1024) + 256,
    };
    const level = process.env.GEMINI_THINKING_LEVEL?.trim();
    if (level) generation_config.thinking_level = level; // minimal|low|medium|high (3.5-flash-lite defaults to minimal)
    const schema =
      req.jsonSchema ??
      (req.task === "verify"
        ? (VERDICT_JSON_SCHEMA as unknown as Record<string, unknown>)
        : req.task === "propose"
          ? (PROPOSAL_JSON_SCHEMA as unknown as Record<string, unknown>)
          : undefined);
    const body: Record<string, unknown> = { model: this.model, system_instruction: req.system, input: req.user, generation_config };
    if (schema) body.response_format = { type: "text", mime_type: "application/json", schema };
    // Safety filters are Off by default for Gemini 2.5+ (docs), so benign transcripts are not blocked; a block surfaces as HTTP 400.

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.base}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new LlmProviderError(e instanceof Error ? e.message : "Gemini network error");
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      let retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      let exhausted = false;
      try {
        const j = JSON.parse(text) as { error?: { message?: string; details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[] } };
        msg = j.error?.message ?? msg;
        for (const d of j.error?.details ?? []) {
          const m = /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay ?? "");
          if (m && retryAfter === undefined) retryAfter = Number(m[1]) * 1000;
        }
        if (/PerDay/i.test(text)) exhausted = true;
      } catch {
        /* non-JSON error body */
      }
      throw new LlmProviderError(`Gemini ${res.status}: ${msg}`, res.status, retryAfter, res.status === 429 && exhausted);
    }
    let j: { output_text?: unknown; steps?: { type?: string; content?: { type?: string; text?: string }[] }[] };
    try {
      j = JSON.parse(text);
    } catch {
      throw new LlmProviderError("Gemini returned a non-JSON response", 502);
    }
    let out = typeof j.output_text === "string" ? j.output_text : "";
    if (!out) {
      out = (j.steps ?? [])
        .filter((s) => s.type !== "thought" && s.type !== "user_input")
        .flatMap((s) => s.content ?? [])
        .filter((c) => (c.type === undefined || c.type === "text") && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("");
    }
    out = out.trim();
    if (!out) throw new LlmProviderError("Gemini returned no text (the response may have been blocked)", 502);
    return out;
  }
}

/* ---------------- resilience layer ---------------- */

export interface ResilienceOptions {
  maxConcurrency: number;
  /** Max provider calls per rolling minute; 0 = unlimited. */
  rpm: number;
  maxRetries: number;
  baseDelayMs: number;
  /** A server-suggested wait above this fails fast as a quota error instead of hanging the request. */
  maxDelayMs: number;
  /** Longest a request may wait in the queue/throttle before failing as a quota error. */
  maxQueueWaitMs: number;
  cacheTtlMs: number;
  cacheMax: number;
  /** Safe input budget in characters (~4 chars per token). */
  maxInputChars: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const num = (name: string, dflt: number) => {
  const n = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(n) && n >= 0 ? n : dflt;
};

export function resilienceFromEnv(provider: LlmProviderName): ResilienceOptions {
  const gemini = provider === "gemini";
  return {
    maxConcurrency: Math.max(1, num("LLM_MAX_CONCURRENCY", 2)),
    // Free-tier RPM is shown only in AI Studio (not in the docs), so default conservatively; raise on a paid key.
    rpm: num("LLM_RPM_LIMIT", gemini ? 10 : 0),
    maxRetries: num("LLM_MAX_RETRIES", 3),
    baseDelayMs: num("LLM_RETRY_BASE_MS", 1000),
    maxDelayMs: num("LLM_RETRY_MAX_DELAY_MS", 20_000),
    maxQueueWaitMs: num("LLM_QUEUE_TIMEOUT_MS", 25_000),
    cacheTtlMs: num("LLM_CACHE_TTL_SECONDS", 600) * 1000,
    cacheMax: 200,
    maxInputChars: num("LLM_MAX_INPUT_CHARS", gemini ? 48_000 : 120_000),
  };
}

/** Keep the head and the tail (so closing untrusted-data delimiters and the final instruction survive); drop the middle. */
export function truncateInput(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  const marker = "\n[...truncated to fit the AI token budget...]\n";
  const keep = max - marker.length;
  const head = Math.floor(keep * 0.7);
  return text.slice(0, head) + marker + text.slice(text.length - (keep - head));
}

/** Retries, throttles, caches and truncates around any transport. The LlmClient contract is unchanged. */
export class ResilientLlm implements LlmClient {
  readonly mode: string;
  readonly provider: LlmProviderName;
  readonly model: string;
  private active = 0;
  private waiters: (() => void)[] = [];
  private calls: number[] = [];
  private cache = new Map<string, { exp: number; value: string }>();
  private inflight = new Map<string, Promise<string>>();
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private random: () => number;

  constructor(
    private transport: LlmTransport,
    private opts: ResilienceOptions = resilienceFromEnv(transport.provider),
  ) {
    this.mode = transport.mode;
    this.provider = transport.provider;
    this.model = transport.model;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  private key(req: LlmRequest): string {
    // The verifier's per-request nonce is random; strip it so identical clips hit the cache.
    const user = req.user.replace(/UNTRUSTED_CLIP_DATA_[0-9a-f]{16}/g, "UNTRUSTED_CLIP_DATA_N");
    return createHash("sha256")
      .update(JSON.stringify([this.transport.provider, this.transport.model, req.task, req.maxTokens ?? 0, req.timeoutMs ?? 0, req.system, user, req.jsonSchema ?? null]))
      .digest("hex");
  }

  async complete(req: LlmRequest): Promise<string> {
    const prepared: LlmRequest = { ...req, user: truncateInput(req.user, this.opts.maxInputChars) };
    const ttl = this.opts.cacheTtlMs;
    if (ttl <= 0) return this.run(prepared);
    const k = this.key(prepared);
    const hit = this.cache.get(k);
    if (hit && hit.exp > this.now()) return hit.value;
    const pending = this.inflight.get(k);
    if (pending) return pending;
    const p = this.run(prepared)
      .then((value) => {
        if (this.cache.size >= this.opts.cacheMax) this.cache.delete(this.cache.keys().next().value as string);
        this.cache.set(k, { exp: this.now() + ttl, value });
        return value;
      })
      .finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }

  private async acquire(deadline: number): Promise<void> {
    while (this.active >= this.opts.maxConcurrency) {
      if (this.now() >= deadline) throw quotaError();
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, Math.max(1, deadline - this.now()));
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    this.active++;
    try {
      await this.throttle(deadline);
    } catch (e) {
      this.release();
      throw e;
    }
  }

  private release() {
    this.active--;
    this.waiters.shift()?.();
  }

  private async throttle(deadline: number): Promise<void> {
    if (this.opts.rpm <= 0) return;
    for (;;) {
      const t = this.now();
      this.calls = this.calls.filter((c) => t - c < 60_000);
      if (this.calls.length < this.opts.rpm) {
        this.calls.push(t);
        return;
      }
      const wait = this.calls[0] + 60_000 - t;
      if (t + wait > deadline) throw quotaError();
      await this.sleep(wait);
    }
  }

  private async run(req: LlmRequest): Promise<string> {
    let lastErr: unknown;
    const budgetEnd = req.timeoutMs ? this.now() + req.timeoutMs : Infinity;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      await this.acquire(Math.min(this.now() + this.opts.maxQueueWaitMs, budgetEnd));
      let wait = -1;
      try {
        return await this.transport.send(req);
      } catch (e) {
        lastErr = e;
        const pe = e instanceof LlmProviderError ? e : null;
        const transient = !pe || pe.status === undefined || [408, 429, 500, 502, 503, 504].includes(pe.status);
        if (transient && !pe?.exhausted && attempt < this.opts.maxRetries) {
          const backoff = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** attempt) * (0.75 + this.random() * 0.5);
          const w = pe?.retryAfterMs !== undefined ? pe.retryAfterMs : backoff;
          if (w <= this.opts.maxDelayMs && this.now() + w < budgetEnd) wait = w; // a longer wait would hang the request: fail fast with a clear error
        }
      } finally {
        this.release(); // the concurrency slot is free during backoff
      }
      if (wait < 0) break;
      await this.sleep(wait);
    }
    throw toApiError(lastErr);
  }
}

/* ---------------- provider selection ---------------- */

const NOT_CONFIGURED_MSG =
  "AI is not configured: set GEMINI_API_KEY (free key from https://aistudio.google.com/apikey) or ANTHROPIC_API_KEY, and optionally LLM_PROVIDER=gemini|anthropic";

export interface ResolvedProvider {
  provider: LlmProviderName;
  apiKey: string;
  model: string;
}

/** LLM_PROVIDER wins; otherwise the only configured key; if both keys exist, Anthropic. Neither -> 503 NOT_CONFIGURED. */
export function resolveProvider(e: Record<string, string | undefined> = process.env): ResolvedProvider {
  const get = (k: string) => e[k]?.trim() || undefined;
  const anth = get("ANTHROPIC_API_KEY");
  const gem = get("GEMINI_API_KEY");
  const forced = get("LLM_PROVIDER")?.toLowerCase();
  let provider: LlmProviderName;
  if (forced) {
    if (forced !== "anthropic" && forced !== "gemini") throw new ApiError(503, "NOT_CONFIGURED", `LLM_PROVIDER must be "anthropic" or "gemini" (got "${forced}")`);
    provider = forced;
    if (provider === "anthropic" && !anth) throw new ApiError(503, "NOT_CONFIGURED", "AI provider anthropic is not configured: set ANTHROPIC_API_KEY (or use LLM_PROVIDER=gemini with GEMINI_API_KEY)");
    if (provider === "gemini" && !gem) throw new ApiError(503, "NOT_CONFIGURED", "AI provider gemini is not configured: set GEMINI_API_KEY (free key from https://aistudio.google.com/apikey) (or use LLM_PROVIDER=anthropic with ANTHROPIC_API_KEY)");
  } else if (anth) provider = "anthropic";
  else if (gem) provider = "gemini";
  else throw new ApiError(503, "NOT_CONFIGURED", NOT_CONFIGURED_MSG);
  return provider === "anthropic"
    ? { provider, apiKey: anth!, model: get("ANTHROPIC_MODEL") || DEFAULT_MODEL }
    : { provider, apiKey: gem!, model: get("GEMINI_TEXT_MODEL") || DEFAULT_GEMINI_MODEL };
}

export function createTransport(r: ResolvedProvider): LlmTransport {
  return r.provider === "anthropic" ? new AnthropicLlm(r.apiKey, r.model) : new GeminiLlm(r.apiKey, r.model);
}

let shared: { sig: string; llm: LlmClient } | null = null;

/** Test hook: drop the shared client (queue, throttle window, cache). */
export function resetLlmForTests() {
  shared = null;
}

export function getLlm(): LlmClient {
  const o = getOverride<LlmClient>("llm");
  if (o) return o;
  const r = resolveProvider();
  const sig = `${r.provider}|${r.model}|${r.apiKey}`;
  // One shared instance so the queue, throttle window and cache span requests.
  if (!shared || shared.sig !== sig) shared = { sig, llm: new ResilientLlm(createTransport(r)) };
  return shared.llm;
}
