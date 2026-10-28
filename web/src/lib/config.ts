import { ApiError } from "./http";

/** 503 "not configured: set X" — raised whenever a real integration is missing its credentials. Never fake success. */
export function notConfigured(what: string, ...envNames: string[]): ApiError {
  return new ApiError(503, "NOT_CONFIGURED", `${what} is not configured: set ${envNames.join(", ")}`);
}

/** Returns the trimmed env value or throws 503 not-configured naming the variable(s). */
export function requireEnv(what: string, ...names: string[]): string {
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length) throw notConfigured(what, ...missing);
  return process.env[names[0]]!.trim();
}

export const env = (name: string) => process.env[name]?.trim() || undefined;

/**
 * Explicit dependency-injection seam for TESTS ONLY (the doubles live in src/test/doubles.ts).
 * Production code never registers overrides; setting one when NODE_ENV=production is refused.
 */
export type OverrideKey = "youtube" | "x" | "instagram" | "llm" | "videoGenerator" | "worldId" | "escrowReader" | "chainSigner" | "transak" | "agentBook";
const g = globalThis as unknown as { __clippoOverrides?: Map<OverrideKey, unknown> };

export function setOverride<T>(key: OverrideKey, impl: T | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("test overrides are not allowed in production");
  g.__clippoOverrides ??= new Map();
  if (impl === null) g.__clippoOverrides.delete(key);
  else g.__clippoOverrides.set(key, impl);
}

export function getOverride<T>(key: OverrideKey): T | undefined {
  return g.__clippoOverrides?.get(key) as T | undefined;
}
