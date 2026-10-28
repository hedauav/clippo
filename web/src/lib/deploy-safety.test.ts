import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as sessionPOST } from "@/app/api/auth/session/route";
import { GET as cronChainSync } from "@/app/api/cron/chain-sync/route";
import { GET as cronStatus } from "@/app/api/cron/status-ladder/route";
import { createToken, getUser } from "@/lib/auth";
import { isCronRequest } from "@/lib/modules/cron";
import { rateLimit } from "@/lib/ratelimit";
import { getStorage, resetStorageForTests, storageMode } from "@/lib/storage";

afterEach(() => {
  vi.unstubAllEnvs();
  resetStorageForTests();
});

const WALLET = "0x000000000000000000000000000000000000dead";
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://clippo-test.vercel.app/api/auth/session", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("production auth hardening", () => {
  it("refuses the dev wallet-only sign-in in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "x".repeat(40));
    const res = await sessionPOST(json({ wallet: WALLET, role: "CREATOR" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("SIGNATURE_REQUIRED");
  });
  it("ignores the x-wallet header in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "x".repeat(40));
    vi.stubEnv("ALLOW_WALLET_HEADER", "true");
    expect(await getUser(new Request("https://x.vercel.app/api/auth/me", { headers: { "x-wallet": WALLET } }))).toBeNull();
  });
  it("requires a 32+ char SESSION_SECRET in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => createToken(WALLET)).toThrow(/SESSION_SECRET/);
    vi.stubEnv("SESSION_SECRET", "short");
    expect(() => createToken(WALLET)).toThrow(/SESSION_SECRET/);
    vi.stubEnv("SESSION_SECRET", "y".repeat(32));
    expect(createToken(WALLET)).toContain(".");
  });
});

describe("cron auth", () => {
  const req = (h: Record<string, string> = {}) => new Request("https://x.vercel.app/api/cron/chain-sync", { headers: h });
  it("accepts Vercel's Bearer secret and the legacy header; rejects everything else", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-s3cret-s3cret");
    expect(isCronRequest(req({ authorization: "Bearer s3cret-s3cret-s3cret" }))).toBe(true);
    expect(isCronRequest(req({ "x-cron-secret": "s3cret-s3cret-s3cret" }))).toBe(true);
    expect(isCronRequest(req({ authorization: "Bearer nope" }))).toBe(false);
    expect(isCronRequest(req())).toBe(false);
  });
  it("never authorises when CRON_SECRET is unset, even with an empty bearer", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronRequest(req({ authorization: "Bearer " }))).toBe(false);
    expect(isCronRequest(req({ "x-cron-secret": "" }))).toBe(false);
  });
  it("cron routes answer 401 without the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-s3cret-s3cret");
    expect((await cronChainSync(req())).status).toBe(401);
    expect((await cronStatus(req())).status).toBe(401);
  });
  it("status-ladder cron is a no-op with the flag off", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-s3cret-s3cret");
    vi.stubEnv("FEATURE_STATUS_LADDER", "false");
    const res = await cronStatus(req({ authorization: "Bearer s3cret-s3cret-s3cret" }));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe(true);
  });
});

describe("storage selection", () => {
  it("is local in dev, blob on Vercel or with Blob credentials, and local-on-Vercel is refused", () => {
    vi.stubEnv("STORAGE_PROVIDER", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("VERCEL", "");
    expect(storageMode()).toBe("local");
    vi.stubEnv("VERCEL", "1");
    expect(storageMode()).toBe("blob");
    vi.stubEnv("STORAGE_PROVIDER", "local");
    resetStorageForTests();
    expect(() => getStorage()).toThrow(/Vercel/);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit then answers 429 (forced on), and is off by default in tests", async () => {
    const r = new Request("https://x.vercel.app/api/x", { headers: { "x-real-ip": "203.0.113.7" } });
    await rateLimit(r, "t-off", 1, 60); // inactive under NODE_ENV=test
    await rateLimit(r, "t-off", 1, 60);
    vi.stubEnv("RATE_LIMIT", "1");
    const name = `t-${Date.now()}`;
    await rateLimit(r, name, 2, 3600);
    await rateLimit(r, name, 2, 3600);
    await expect(rateLimit(r, name, 2, 3600)).rejects.toMatchObject({ status: 429 });
  });
});
