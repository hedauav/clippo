/**
 * Backend integration pass: regression for the 500s (stale Prisma client), the CRE snapshot contract, campaign views history,
 * per-creator dashboard figures, referral visit cookie, Transak webhook signature, World ID verification shape, profile signer.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setOverride } from "./config";
import { clearDoubles, fakeSigner, installChainDouble, installDoubles } from "@/test/doubles";
import { resetDb } from "@/test/db";
import { normalizeSnapshot } from "../../../cre/workflows/clippo-settlement/snapshot";

type Db = typeof import("@/lib/db").db;
let db: Db;
const W = { camp: "0xca00000000000000000000000000000000000a01", c1: "0x1111111111111111111111111111111111111111", c2: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", admin: "0xad00000000000000000000000000000000000a09" };
const req = (url: string, wallet?: string, init: RequestInit = {}) => new Request(`http://localhost${url}`, { ...init, headers: { host: "localhost", ...(wallet ? { "x-wallet": wallet } : {}), ...(init.headers ?? {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const today = (off = 0) => new Date(Date.now() - off * 86400_000).toISOString().slice(0, 10);

const ids: Record<string, string> = {};

beforeAll(async () => {
  process.env.ADMIN_WALLETS = W.admin;
  installDoubles();
  installChainDouble();
  db = (await import("@/lib/db")).db;
  await resetDb(db);
  const mk = (wallet: string, role: "CAMPAIGNER" | "CREATOR" | "ADMIN", verified = true) => db.user.create({ data: { wallet, role, verified } });
  const camp = await mk(W.camp, "CAMPAIGNER");
  const c1 = await mk(W.c1, "CREATOR");
  const c2 = await mk(W.c2, "CREATOR");
  await mk(W.admin, "ADMIN");
  const ch1 = await db.channel.create({ data: { userId: c1.id, platform: "YOUTUBE", handle: "one", verificationCode: "x", verified: true } });
  const ch2 = await db.channel.create({ data: { userId: c2.id, platform: "YOUTUBE", handle: "two", verificationCode: "x", verified: true } });
  const base = { campaignerId: camp.id, title: "t", story: {}, contentSource: "LINK" as const, platforms: ["YOUTUBE"], status: "APPROVED" as const };
  const perView = await db.campaign.create({ data: { ...base, payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 1000, onchainId: "7" } });
  const noChain = await db.campaign.create({ data: { ...base, payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 1000 } }); // no on-chain id
  const split = await db.campaign.create({ data: { ...base, payoutMode: "HUMAN_SPLIT", approver: "CAMPAIGNER_AND_ADMIN", poolSize: 500, onchainId: "12" } });
  Object.assign(ids, { camp: camp.id, c1: c1.id, c2: c2.id, perView: perView.id, noChain: noChain.id, split: split.id });
  const clip = async (campaignId: string, creatorId: string, channelId: string, videoId: string, series: [number, number][]) => {
    const s = await db.submission.create({ data: { campaignId, creatorId, channelId, link: `https://youtu.be/${videoId}`, videoId, metadata: {}, verdict: { create: { result: "APPROVE", confidence: 0.9, reason: "ok" } } } });
    for (const [off, v] of series) await db.viewSnapshot.create({ data: { campaignId, submissionId: s.id, creatorId, day: today(off), cumulativeViews: v } });
    return s;
  };
  await clip(perView.id, c1.id, ch1.id, "pv-one", [[2, 1000], [1, 1500], [0, 2000]]);
  await clip(perView.id, c2.id, ch2.id, "pv-two", [[1, 300], [0, 800]]);
  await clip(noChain.id, c1.id, ch1.id, "nc-one", [[0, 99]]);
  await clip(split.id, c2.id, ch2.id, "sp-two", [[0, 5000]]);
  await db.payout.create({ data: { campaignId: perView.id, creatorId: c1.id, amount: 4, claimedAmount: 1.5 } });
});

afterAll(async () => {
  clearDoubles();
  await db?.$disconnect();
});

describe("regression: 500s on /api/creators, /api/leaderboard, /api/campaigns/:id", () => {
  it("the generated Prisma client knows every model in schema.prisma (stale client was the root cause)", () => {
    const schema = readFileSync(path.resolve(import.meta.dirname, "../../prisma/schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
    const known = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(models.filter((m) => !known.includes(m))).toEqual([]);
    const campaign = Prisma.dmmf.datamodel.models.find((m) => m.name === "Campaign")!.fields.map((f) => f.name);
    expect(campaign).toContain("adminReviewReason");
  });

  it("the three endpoints answer 200", async () => {
    const creators = (await import("@/app/api/creators/route")).GET;
    const board = (await import("@/app/api/leaderboard/route")).GET;
    const one = (await import("@/app/api/campaigns/[id]/route")).GET;
    expect((await creators(req("/api/creators"))).status).toBe(200);
    const lb = await board(req("/api/leaderboard"));
    expect(lb.status).toBe(200);
    expect(((await lb.json()) as { creators: unknown[] }).creators.length).toBeGreaterThan(0);
    const r = await one(req(`/api/campaigns/${ids.perView}`), ctx(ids.perView));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { performance: { totalViews: number } }).performance.totalViews).toBe(2800);
  });
});

describe("snapshot feed <-> CRE contract (shared fixture cre/workflows/clippo-settlement/fixtures/snapshot-feed.json)", () => {
  const fx = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../cre/workflows/clippo-settlement/fixtures/snapshot-feed.json"), "utf8")) as { backendFeed: unknown[]; normalized: string };

  it("emits numeric on-chain campaign ids, skips campaigns without one, and the CRE normalizer accepts it", async () => {
    const { GET } = await import("@/app/api/snapshots/latest/route");
    const feed = (await (await GET()).json()) as { campaignId: string; creator: string; cumulativeViews: number }[];
    expect(feed.every((r) => /^\d+$/.test(r.campaignId))).toBe(true);
    expect(feed).toEqual([
      { campaignId: "7", creator: W.c1, cumulativeViews: 2000 },
      { campaignId: "7", creator: W.c2, cumulativeViews: 800 },
      { campaignId: "12", creator: W.c2, cumulativeViews: 5000 },
    ]);
    const rows = JSON.parse(normalizeSnapshot(feed)) as { campaignId: string }[];
    expect(rows).toHaveLength(3); // nothing dropped by the CRE side
  });

  it("the shared fixture normalises to the canonical string on the web side too", () => {
    expect(normalizeSnapshot(fx.backendFeed)).toBe(fx.normalized);
  });
});

describe("campaign views history and per-creator performance", () => {
  it("GET /api/campaigns/:id/views returns daily cumulative views", async () => {
    const { GET } = await import("@/app/api/campaigns/[id]/views/route");
    const r = await GET(req(`/api/campaigns/${ids.perView}/views`), ctx(ids.perView));
    const j = (await r.json()) as { points: { day: string; views: number; dailyViews: number; clips: number }[]; totalViews: number };
    expect(j.points.map((p) => p.views)).toEqual([1000, 1800, 2800]);
    expect(j.points.map((p) => p.dailyViews)).toEqual([1000, 800, 1000]);
    expect(j.totalViews).toBe(2800);
  });

  it("campaigner dashboard carries views, approved clips, cost, paid and claimed per creator", async () => {
    const { GET } = await import("@/app/api/dashboard/campaigner/route");
    const r = await GET(req("/api/dashboard/campaigner", W.camp));
    const j = (await r.json()) as { campaigns: { campaignId: string; creators: Record<string, unknown>[] }[] };
    const pv = j.campaigns.find((c) => c.campaignId === ids.perView)!;
    const one = pv.creators.find((c) => c.creatorId === ids.c1)!;
    expect(one).toMatchObject({ views: 2000, approvedClips: 1, paid: 4, claimed: 1.5, costBasis: "estimated" });
    expect(one.cost).toBeGreaterThanOrEqual(4); // (2000/1000)*2 = 4 estimated, never below credited
    const sp = j.campaigns.find((c) => c.campaignId === ids.split)!;
    expect(sp.creators[0]).toMatchObject({ costBasis: "allocated", views: 5000 });
  });
});

describe("referral first visit", () => {
  it("GET /api/referral/visit?code= validates the code and sets the clippo_ref cookie", async () => {
    vi.stubEnv("FEATURE_REFERRAL", "true");
    await db.referralLink.create({ data: { code: "abc123", referrerId: ids.c1, campaignId: ids.perView } });
    const { GET } = await import("@/app/api/referral/visit/route");
    const ok = await GET(req("/api/referral/visit?code=abc123"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/clippo_ref=abc123/);
    expect((await GET(req("/api/referral/visit?code=nope"))).status).toBe(404);
    const { POST } = await import("@/app/api/referral/attribute/route");
    const att = await POST(req("/api/referral/attribute", W.c2, { method: "POST", headers: { cookie: "clippo_ref=abc123" } }));
    expect(att.status).toBe(403); // referee has no World ID nullifier yet: still enforced
    vi.unstubAllEnvs();
  });
});

describe("Transak", () => {
  it("verifies the webhook JWT signature (HS256) and rejects tampering", async () => {
    const { verifyTransakJwt } = await import("@/lib/onramp/transak");
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const mkJwt = (payload: object, secret: string) => {
      const h = b64({ alg: "HS256", typ: "JWT" });
      const p = b64(payload);
      return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
    };
    const good = mkJwt({ webhookData: { status: "COMPLETED" } }, "tok");
    expect(verifyTransakJwt(good, "tok")).toMatchObject({ webhookData: { status: "COMPLETED" } });
    expect(verifyTransakJwt(good, "other")).toBeNull();
    expect(verifyTransakJwt(good.replace(/.$/, "A"), "tok")).toBeNull();
    expect(verifyTransakJwt(mkJwt({ exp: 1 }, "tok"), "tok")).toBeNull();
  });

  it("session endpoint creates a widget URL via the client, and is a loud 503 without credentials", async () => {
    const { POST } = await import("@/app/api/onramp/session/route");
    vi.stubEnv("TRANSAK_API_KEY", "");
    const off = await POST(req("/api/onramp/session", W.camp, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: 100 }) }));
    expect(off.status).toBe(503);
    vi.stubEnv("TRANSAK_API_KEY", "k");
    setOverride("transak", { createWidgetUrl: async (p: Record<string, string | number>) => `https://global-stg.transak.com/?w=${p.walletAddress}&amt=${p.fiatAmount}` });
    const r = await POST(req("/api/onramp/session", W.camp, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: 100 }) }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { url: string }).url).toContain("amt=100");
    setOverride("transak", null);
    vi.unstubAllEnvs();
  });
});

describe("World ID v4", () => {
  it("fails loudly without configuration, and forwards the IDKit result unmodified to /api/v4/verify/{rp_id}", async () => {
    const { RealWorldId, toVerifyBody } = await import("@/lib/worldid");
    vi.stubEnv("WORLD_ID_RP_ID", "");
    await expect(new RealWorldId().verify({ protocol_version: "4.0", responses: [{ identifier: "orb", nullifier: "0x1" }] }, "a")).rejects.toThrow(/not configured: set WORLD_ID_APP_ID/);
    vi.stubEnv("WORLD_ID_APP_ID", "app_x");
    vi.stubEnv("WORLD_ID_RP_ID", "rp_x");
    vi.stubEnv("WORLD_ID_SIGNING_KEY", "0x" + "11".repeat(32));
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(init.body as string) });
      return Response.json({ success: true, environment: "production", nullifier: "0xabc" });
    }));
    const idk = { protocol_version: "4.0", nonce: "n", action: "act", environment: "production", responses: [{ identifier: "orb", nullifier: "0xabc", proof: "p" }] };
    expect(await new RealWorldId().verify(idk, "act")).toEqual({ ok: true, nullifier: "0xabc" });
    expect(seen[0].url).toBe("https://developer.world.org/api/v4/verify/rp_x");
    expect(seen[0].body).toMatchObject(idk);
    // wrong action / environment are refused before any network call
    expect(await new RealWorldId().verify({ ...idk, action: "other" }, "act")).toMatchObject({ ok: false });
    expect(await new RealWorldId().verify({ ...idk, environment: "staging" }, "act")).toMatchObject({ ok: false });
    expect(seen).toHaveLength(1);
    // legacy shape is mapped to a v3 request
    expect(toVerifyBody({ nullifier_hash: "0x1", proof: "p", merkle_root: "0x2" }, "act")).toMatchObject({ protocol_version: "3.0", responses: [{ identifier: "orb", nullifier: "0x1" }] });
    // rejection from the portal -> denied
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, detail: "max verifications reached" }, { status: 400 })));
    expect(await new RealWorldId().verify(idk, "act")).toEqual({ ok: false, reason: "max verifications reached" });
    const { createRpContext } = await import("@/lib/worldid");
    expect(createRpContext("act")).toMatchObject({ rp_id: "rp_x", app_id: "app_x", action: "act" });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("creator profile sync signer", () => {
  it("writes through the updater signer and records the tx; skips creators without an on-chain profile", async () => {
    vi.stubEnv("FEATURE_TOKENIZATION", "true");
    const signer = fakeSigner();
    setOverride("chainSigner", signer);
    await db.onchainProfile.create({ data: { userId: ids.c1, optedIn: true } });
    const { syncProfiles } = await import("@/lib/modules/profile");
    const r = await syncProfiles();
    expect(r).toMatchObject({ checked: 1, changed: 1, skipped: 0 });
    expect(signer.calls).toHaveLength(1);
    expect((await db.onchainProfile.findUniqueOrThrow({ where: { userId: ids.c1 } })).txHash).toMatch(/^0xab/);
    const { ProfileNotOnchainError } = await import("@/lib/chain/signer");
    await db.onchainProfile.update({ where: { userId: ids.c1 }, data: { payloadHash: null } });
    const skipped = await syncProfiles(async () => {
      throw new ProfileNotOnchainError("0x1");
    });
    expect(skipped).toMatchObject({ changed: 0, skipped: 1 });
    // unconfigured signer is a loud 503
    setOverride("chainSigner", null);
    vi.stubEnv("UPDATER_PRIVATE_KEY", "");
    await db.onchainProfile.update({ where: { userId: ids.c1 }, data: { payloadHash: null } });
    await expect(syncProfiles()).rejects.toThrow(/not configured: set UPDATER_PRIVATE_KEY/);
    vi.unstubAllEnvs();
  });
});

describe("split proposals listing and deals listing", () => {
  it("GET /api/campaigns/:id/split lists pending proposals with who is awaited", async () => {
    await db.splitProposal.create({ data: { campaignId: ids.split, splitHash: "0xhash", splits: [{ creatorWallet: W.c2, amount: 100, units: "100000000" }], campaignerApprovedAt: new Date() } });
    const { GET } = await import("@/app/api/campaigns/[id]/split/route");
    const r = await GET(req(`/api/campaigns/${ids.split}/split`, W.camp), ctx(ids.split));
    const j = (await r.json()) as { proposals: { awaiting: string[]; approvals: object; splitHash: string }[] };
    expect(j.proposals[0]).toMatchObject({ awaiting: ["admin"], approvals: { campaigner: true, admin: false }, splitHash: "0xhash" });
    const q = (await import("@/app/api/admin/queue/route")).GET;
    expect(((await (await q(req("/api/admin/queue", W.admin))).json()) as { splitProposals: unknown[] }).splitProposals).toHaveLength(1);
    const a = (await import("@/app/api/admin/split-proposals/route")).GET;
    expect(((await (await a(req("/api/admin/split-proposals", W.admin))).json()) as { proposals: unknown[] }).proposals).toHaveLength(1);
  });

  it("GET /api/campaigns/:id/deals lists the campaign's deals for the campaigner without a creator picker", async () => {
    await db.deal.create({ data: { campaignId: ids.perView, campaignerId: ids.camp, creatorId: ids.c1, offers: [{ by: "creator", rate: 2, note: "", at: new Date().toISOString() }] } });
    await db.dealTerms.create({ data: { campaignId: ids.perView, minRate: 1, maxRate: 3 } });
    const { GET } = await import("@/app/api/campaigns/[id]/deals/route");
    const r = await GET(req(`/api/campaigns/${ids.perView}/deals`, W.camp), ctx(ids.perView));
    const j = (await r.json()) as { deals: { creatorId: string; wallet: string }[]; band: { minRate: number } };
    expect(j.deals).toHaveLength(1);
    expect(j.deals[0]).toMatchObject({ creatorId: ids.c1, wallet: W.c1 });
    expect(j.band.minRate).toBe(1);
  });
});

describe("YouTube transcript fetch", () => {
  it("reads the public caption track from the watch page and flattens json3 events", async () => {
    const { RealYouTube } = await import("@/lib/youtube");
    const tracks = JSON.stringify([{ baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=en", languageCode: "en" }]);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/watch")) return new Response(`xx"captionTracks":${tracks},"audioTracks":[]`);
      if (u.includes("timedtext")) return Response.json({ events: [{ segs: [{ utf8: "hello" }, { utf8: "world\n" }] }, { segs: [{ utf8: "sponsored" }] }] });
      if (u.includes("/videos")) return Response.json({ items: [{ snippet: { title: "t", description: "d", channelId: "UC1", publishedAt: "2026-01-01T00:00:00Z" }, statistics: { viewCount: "42" } }] });
      return Response.json({ items: [{ snippet: { customUrl: "@one" } }] });
    }));
    const v = await new RealYouTube("k").fetchVideo("https://youtu.be/abcdefghijk");
    expect(v).toMatchObject({ transcript: "hello world sponsored", views: 42, channelHandle: "one" });
    vi.unstubAllGlobals();
  });
});
