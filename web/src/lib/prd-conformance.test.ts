/**
 * PRD conformance tests (docs/BACKEND_CONFORMANCE.md). Each describe names the PRD section it covers. Handlers are called
 * directly against the throwaway PGlite database with the explicit test doubles from src/test/doubles.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearDoubles, installChainDouble, installDoubles } from "@/test/doubles";
import { resetDb } from "@/test/db";
import { checkStoryRules, verifyClip, type Story } from "@/lib/ai/verifier";
import type { LlmClient } from "@/lib/ai/llm";
import { configFees, FEE_BPS_MAX, FEE_BPS_MIN } from "@/lib/chain/fees";

process.env.ALLOW_WALLET_HEADER = "true";
type Db = typeof import("@/lib/db").db;
let db: Db;
const req = (url: string, wallet?: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { host: "localhost", ...(wallet ? { "x-wallet": wallet } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any });
const W = {
  camp: "0xca00000000000000000000000000000000000b01",
  cre1: "0x1111111111111111111111111111111111110001",
  cre2: "0x2222222222222222222222222222222222220002",
  unv: "0x3333333333333333333333333333333333330003",
  adm: "0xad00000000000000000000000000000000000b09",
};
const story = { summary: "Promote Ledgerlane", topic: "Ledgerlane accounting close", requiredPoints: ["closes the books"], prohibitedClaims: ["risk-free"], disclosureLabel: "#ad", attribution: "Credit the original creator" };

beforeAll(async () => {
  process.env.ADMIN_WALLETS = W.adm;
  for (const k of ["FEATURE_TOKENIZATION", "FEATURE_REFERRAL", "FEATURE_STATUS_LADDER", "ESCROW_ADDRESS"]) delete process.env[k];
  installDoubles();
  db = (await import("@/lib/db")).db;
  await resetDb(db);
  const mk = (wallet: string, role: "CAMPAIGNER" | "CREATOR" | "ADMIN", verified = true) => db.user.create({ data: { wallet, role, verified } });
  await mk(W.camp, "CAMPAIGNER");
  await mk(W.cre1, "CREATOR");
  await mk(W.cre2, "CREATOR");
  await mk(W.unv, "CREATOR", false);
  await mk(W.adm, "ADMIN");
});
afterAll(async () => {
  clearDoubles();
  await db?.$disconnect();
});

describe("PRD 4.3 wizard: every option of every question is accepted and persisted", () => {
  it("suggest + create for each content source, platform set, payout mode, basis, approver and eligibility", async () => {
    const { POST: suggest } = await import("@/app/api/wizard/suggest/route");
    const { POST: create, GET: list } = await import("@/app/api/campaigns/route");
    const combos = [
      { contentSource: "UPLOAD", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", eligibility: "ANYONE_VERIFIED", ratePer1k: 2 },
      { contentSource: "LINK", platforms: ["X"], payoutMode: "HUMAN_SPLIT", approver: "CAMPAIGNER_ONLY", eligibility: "HIGHER_RANKED" },
      { contentSource: "AI_GENERATED", platforms: ["INSTAGRAM"], payoutMode: "HUMAN_SPLIT", approver: "CAMPAIGNER_AND_ADMIN", eligibility: "ANYONE_VERIFIED" },
      { contentSource: "LINK", platforms: ["YOUTUBE", "X", "INSTAGRAM"], payoutMode: "POOL_SHARE", poolShareBasis: "VIEWS", eligibility: "ANYONE_VERIFIED" },
      { contentSource: "LINK", platforms: ["YOUTUBE", "X"], payoutMode: "POOL_SHARE", poolShareBasis: "APPROVED_CLIPS", eligibility: "HIGHER_RANKED" },
    ] as const;
    for (const c of combos) {
      const s = await j(await suggest(req("/api/wizard/suggest", W.camp, { idea: "Promote Ledgerlane, an accounting close tool", ...c })));
      expect(s.status).toBe(200);
      expect(s.body.story.requiredPoints.length).toBeGreaterThan(0);
      expect(s.body.story.disclosureLabel).toBeTruthy();
      expect(s.body.suggestions.length).toBeGreaterThanOrEqual(3); // suggested pool / rate / view-target options
      expect(s.body.suggestions.every((x: { ratePer1k: number | null }) => (c.payoutMode === "PER_VIEW" ? x.ratePer1k !== null : x.ratePer1k === null))).toBe(true);
      const created = await j(await create(req("/api/campaigns", W.camp, { title: "T", story: s.body.story, poolSize: s.body.suggestions[0].poolSize, viewTarget: s.body.suggestions[0].viewTarget, ...c })));
      expect(created.status).toBe(201);
      expect(created.body.campaign).toMatchObject({ contentSource: c.contentSource, payoutMode: c.payoutMode, eligibility: c.eligibility, status: "DRAFT" });
      expect(created.body.campaign.platforms).toEqual(c.platforms);
      expect(created.body.campaign.poolShareBasis).toBe(("poolShareBasis" in c ? c.poolShareBasis : null) ?? null);
      expect(created.body.campaign.approver).toBe(("approver" in c ? c.approver : null) ?? null);
    }
    // a DRAFT is private to its owner: the open marketplace lists APPROVED campaigns only
    expect((await j(await list(req("/api/campaigns")))).body.campaigns).toHaveLength(0);
    expect((await j(await list(req("/api/campaigns?mine=true", W.camp)))).body.campaigns).toHaveLength(combos.length);
  });

  it("rejects an incomplete answer set: pool share needs a basis, approved split needs an approver, per view needs a rate", async () => {
    const { POST: create } = await import("@/app/api/campaigns/route");
    const base = { title: "T", story, contentSource: "LINK", platforms: ["YOUTUBE"], poolSize: 100 };
    for (const bad of [{ payoutMode: "POOL_SHARE" }, { payoutMode: "HUMAN_SPLIT" }, { payoutMode: "PER_VIEW" }, { payoutMode: "PER_VIEW", ratePer1k: 1, platforms: [] }]) {
      expect((await j(await create(req("/api/campaigns", W.camp, { ...base, ...bad })))).status).toBe(400);
    }
    expect((await j(await create(req("/api/campaigns", W.cre1, { ...base, payoutMode: "PER_VIEW", ratePer1k: 1 })))).status).toBe(403); // creators cannot create campaigns
  });
});

describe("PRD 4.5 / 5 platform fee and funding", () => {
  it("fee is 0.1 to 0.5 percent per side (10..50 bps); out-of-range configuration falls back", () => {
    expect([FEE_BPS_MIN, FEE_BPS_MAX]).toEqual([10, 50]);
    const save = { a: process.env.PLATFORM_CAMPAIGNER_FEE_BPS, b: process.env.PLATFORM_CREATOR_FEE_BPS };
    try {
      process.env.PLATFORM_CAMPAIGNER_FEE_BPS = "0";
      process.env.PLATFORM_CREATOR_FEE_BPS = "10";
      expect(configFees()).toMatchObject({ campaignerBps: 25, creatorBps: 10 });
      process.env.PLATFORM_CAMPAIGNER_FEE_BPS = "50";
      process.env.PLATFORM_CREATOR_FEE_BPS = "51";
      expect(configFees()).toMatchObject({ campaignerBps: 50, creatorBps: 25 });
    } finally {
      if (save.a === undefined) delete process.env.PLATFORM_CAMPAIGNER_FEE_BPS;
      else process.env.PLATFORM_CAMPAIGNER_FEE_BPS = save.a;
      if (save.b === undefined) delete process.env.PLATFORM_CREATOR_FEE_BPS;
      else process.env.PLATFORM_CREATOR_FEE_BPS = save.b;
    }
  });

  it("fund preview shows the campaigner-side fee; recording funding without a configured escrow is NOT_CONFIGURED (no mock funding)", async () => {
    const c = await db.campaign.findFirstOrThrow({ where: { payoutMode: "PER_VIEW" } });
    const { GET, POST } = await import("@/app/api/campaigns/[id]/fund/route");
    const p = await j(await GET(req(`/api/campaigns/${c.id}/fund`, W.camp), ctx(c.id)));
    expect(p.status).toBe(200);
    expect(p.body.preview.campaignerFeeBps).toBeGreaterThanOrEqual(10);
    expect(p.body.preview.campaignerFeeBps).toBeLessThanOrEqual(50);
    expect(p.body.preview.netPool).toBeLessThan(p.body.preview.poolAmount);
    expect(p.body.createCampaignArgs.mode).toBe(0);
    const f = await j(await POST(req(`/api/campaigns/${c.id}/fund`, W.camp, { txHash: "0x" + "ab".repeat(32) }), ctx(c.id)));
    expect(f.status).toBe(503);
    expect(f.body.error.code).toBe("NOT_CONFIGURED");
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DRAFT");
    expect((await j(await POST(req(`/api/campaigns/${c.id}/fund`, W.cre1, { txHash: "0x1" }), ctx(c.id)))).status).toBe(403);
  });
});

describe("PRD 5 chain: every chain-dependent endpoint answers 503 without an escrow, never 500", () => {
  it("POST /api/chain/sync (admin) and claim receipts are CHAIN_NOT_CONFIGURED / NOT_CONFIGURED", async () => {
    const { POST: sync } = await import("@/app/api/chain/sync/route");
    const r = await j(await sync(req("/api/chain/sync", W.adm, {})));
    expect([r.status, r.body.error.code]).toEqual([503, "CHAIN_NOT_CONFIGURED"]);
    expect((await j(await sync(req("/api/chain/sync", W.cre1, {})))).status).toBe(403);
    expect((await j(await sync(req("/api/chain/sync")))).status).toBe(401);
  });
});

describe("PRD 3.3 / 4.6 admin approval before join, refund on reject", () => {
  it("a campaign cannot take submissions until APPROVED; non-admins cannot approve; a reject needs the escrow refund to have happened", async () => {
    const camp = await db.user.findUniqueOrThrow({ where: { wallet: W.camp } });
    const cre = await db.user.findUniqueOrThrow({ where: { wallet: W.cre1 } });
    const c = await db.campaign.create({
      data: { campaignerId: camp.id, title: "Funded", story, contentSource: "LINK", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 400, status: "FUNDED", onchainId: "41", grossFunded: 400, campaignerFee: 1, campaignerFeeBps: 25, creatorFeeBps: 25 },
    });
    const ch = await db.channel.create({ data: { userId: cre.id, platform: "YOUTUBE", handle: "gate", verificationCode: "x", verified: true } });
    const subs = await import("@/app/api/submissions/route");
    const early = await j(await subs.POST(req("/api/submissions", W.cre1, { campaignId: c.id, channelId: ch.id, link: "https://youtu.be/gate0000001" })));
    expect(early.status).toBe(404); // not open: FUNDED but not admin-approved
    const approve = await import("@/app/api/campaigns/[id]/approve/route");
    expect((await j(await approve.POST(req(`/api/campaigns/${c.id}/approve`, W.camp, {}), ctx(c.id)))).status).toBe(403);
    expect((await j(await approve.POST(req(`/api/campaigns/${c.id}/approve`, W.cre1, {}), ctx(c.id)))).status).toBe(403);
    // chain not configured: admin approve/reject say NOT_CONFIGURED instead of pretending
    const reject = await import("@/app/api/campaigns/[id]/reject/route");
    expect((await j(await approve.POST(req(`/api/campaigns/${c.id}/approve`, W.adm, {}), ctx(c.id)))).body.error.code).toBe("NOT_CONFIGURED");
    expect((await j(await reject.POST(req(`/api/campaigns/${c.id}/reject`, W.adm, { reason: "no" }), ctx(c.id)))).body.error.code).toBe("NOT_CONFIGURED");
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("FUNDED");

    // with the escrow configured: reject only takes effect once the escrow shows Rejected (full refund incl. fee)
    installChainDouble({ getCampaign: async () => ({ state: 1, campaignerFeeBps: 25, creatorFeeBps: 25, highValue: false }) as never });
    expect((await j(await reject.POST(req(`/api/campaigns/${c.id}/reject`, W.adm, { reason: "no" }), ctx(c.id)))).body.error.code).toBe("CHAIN_STATE_MISMATCH");
    installChainDouble({ getCampaign: async () => ({ state: 3, campaignerFeeBps: 25, creatorFeeBps: 25, highValue: false }) as never });
    const rej = await j(await reject.POST(req(`/api/campaigns/${c.id}/reject`, W.adm, { reason: "off brief" }), ctx(c.id)));
    expect(rej.status).toBe(200);
    expect(rej.body.campaign).toMatchObject({ status: "REJECTED", rejectReason: "off brief" });
    expect(rej.body.refund).toEqual({ amount: 400, includesFee: true, onchain: true });
    delete process.env.ESCROW_ADDRESS;
  });

  it("the admin queue shows funded campaigns, flagged clips, appeals and unusual view patterns", async () => {
    const camp = await db.user.findUniqueOrThrow({ where: { wallet: W.camp } });
    const cre = await db.user.findUniqueOrThrow({ where: { wallet: W.cre1 } });
    const c = await db.campaign.create({ data: { campaignerId: camp.id, title: "Queue", story, contentSource: "LINK", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 100, status: "FUNDED" } });
    const ch = await db.channel.findFirstOrThrow({ where: { userId: cre.id } });
    const mkSub = (videoId: string, result: "NEEDS_HUMAN" | "REJECT", appealStatus: "NONE" | "PENDING" = "NONE") =>
      db.submission.create({ data: { campaignId: c.id, creatorId: cre.id, channelId: ch.id, link: `https://youtu.be/${videoId}`, videoId, metadata: {}, verdict: { create: { result, confidence: 0.4, reason: "r", appealStatus } } } });
    const flagged = await mkSub("q-flag", "NEEDS_HUMAN");
    const appealed = await mkSub("q-appeal", "REJECT", "PENDING");
    await db.fraudFlag.create({ data: { kind: "VIEW_ANOMALY", campaignId: c.id, submissionId: flagged.id, day: "2026-10-01", details: {} } });
    const { GET } = await import("@/app/api/admin/queue/route");
    expect((await j(await GET(req("/api/admin/queue", W.camp)))).status).toBe(403);
    const q = (await j(await GET(req("/api/admin/queue", W.adm)))).body;
    expect(q.pendingCampaigns.map((x: { id: string }) => x.id)).toContain(c.id);
    expect(q.flaggedSubmissions.map((x: { id: string }) => x.id)).toContain(flagged.id);
    expect(q.appeals.map((x: { id: string }) => x.id)).toContain(appealed.id);
    expect(q.fraudFlags.some((f: { kind: string }) => f.kind === "VIEW_ANOMALY")).toBe(true);
  });
});

describe("PRD 4.1 channel ownership proof with several channels; unique human gate", () => {
  it("a verified creator links several channels (one per platform/handle) and sees them as their socials; an unverified account cannot", async () => {
    const { POST: add, GET: mine } = await import("@/app/api/channels/route");
    const { POST: verify } = await import("@/app/api/channels/[id]/verify/route");
    expect((await j(await add(req("/api/channels", W.unv, { platform: "YOUTUBE", handle: "nope" })))).body.error.code).toBe("NOT_VERIFIED");
    const ids: string[] = [];
    for (const [platform, handle] of [["YOUTUBE", "alpha"], ["X", "beta"], ["INSTAGRAM", "gamma"]] as const) {
      const r = await j(await add(req("/api/channels", W.cre2, { platform, handle })));
      expect(r.status).toBe(201);
      expect(r.body.channel.verificationCode).toMatch(/^clippo-/); // the code the creator places in the bio
      expect(r.body.channel.verified).toBe(false);
      ids.push(r.body.channel.id);
    }
    expect((await j(await verify(req("/api/channels/x/verify", W.cre2, {}), ctx(ids[0])))).body.channel.verified).toBe(true);
    const bad = await j(await add(req("/api/channels", W.cre2, { platform: "YOUTUBE", handle: "failing" })));
    const fail = await j(await verify(req("/api/channels/x/verify", W.cre2, {}), ctx(bad.body.channel.id)));
    expect(fail.status).toBe(422);
    expect(fail.body.error.code).toBe("CODE_NOT_FOUND");
    expect((await j(await verify(req("/api/channels/x/verify", W.cre1, {}), ctx(ids[1])))).status).toBe(404); // someone else's channel
    const list = (await j(await mine(req("/api/channels", W.cre2)))).body.channels;
    expect(list).toHaveLength(4);
    expect(list.filter((c: { verified: boolean }) => c.verified)).toHaveLength(1);
    // a channel linked by one account cannot be claimed by another
    expect((await j(await add(req("/api/channels", W.cre1, { platform: "YOUTUBE", handle: "alpha" })))).body.error.code).toBe("CHANNEL_TAKEN");
  });
});

describe("PRD 4.2 verification agent: disclosure label and prohibited claims are checked deterministically", () => {
  const approver = { mode: "test", complete: async () => JSON.stringify({ result: "APPROVE", confidence: 0.97, reason: "matches" }) } as LlmClient;
  const s: Story = { summary: "x", topic: "Ledgerlane accounting close", requiredPoints: ["closes the books"], prohibitedClaims: ["risk-free", "guaranteed returns"], disclosureLabel: "#ad", attribution: "" };
  const input = (transcript: string, title = "t", description = "d") => ({ story: s, transcript, title, description, channelOwned: true, existing: [] });

  it("checkStoryRules: generic labels accept sponsorship synonyms, whole words only", () => {
    expect(checkStoryRules(s, "this is a bad video").missingDisclosure).toBe(true); // "ad" inside "bad" is not a label
    expect(checkStoryRules(s, "Sponsored by Ledgerlane").missingDisclosure).toBe(false);
    expect(checkStoryRules(s, "closing #ad").missingDisclosure).toBe(false);
    expect(checkStoryRules({ ...s, disclosureLabel: "Paid for by Acme" }, "paid for by acme!").missingDisclosure).toBe(false);
    expect(checkStoryRules({ ...s, disclosureLabel: "Paid for by Acme" }, "sponsored").missingDisclosure).toBe(true);
    expect(checkStoryRules(s, "This is Risk-Free!").prohibitedHit).toBe("risk-free");
  });
  it("an LLM approval is downgraded to human review when the label is missing or a prohibited claim is present; a clean clip passes", async () => {
    const clean = await verifyClip(input("#ad Ledgerlane closes the books fast"), approver);
    expect(clean).toMatchObject({ result: "APPROVE" });
    const noLabel = await verifyClip(input("Ledgerlane closes the books fast"), approver);
    expect(noLabel.result).toBe("NEEDS_HUMAN");
    expect(noLabel.flags).toContain("disclosure_missing");
    expect(noLabel.reason).toMatch(/disclosure label/);
    const claim = await verifyClip(input("#ad Ledgerlane is risk-free and closes the books"), approver);
    expect(claim.result).toBe("NEEDS_HUMAN");
    expect(claim.flags).toContain("prohibited_claim_suspected");
    const inTitle = await verifyClip(input("Ledgerlane closes the books", "#ad Ledgerlane"), approver);
    expect(inTitle.result).toBe("APPROVE"); // label may sit in the title/description (e.g. #ad)
  });
});

describe("PRD 4.4 pool share: weights by verified views or by approved clips, as chosen", () => {
  it("GET /api/campaigns/:id/pool-share returns pro-rata weights and the setWeights arguments", async () => {
    const camp = await db.user.findUniqueOrThrow({ where: { wallet: W.camp } });
    const [u1, u2] = await Promise.all([db.user.findUniqueOrThrow({ where: { wallet: W.cre1 } }), db.user.findUniqueOrThrow({ where: { wallet: W.cre2 } })]);
    const day = new Date().toISOString().slice(0, 10);
    const mkCampaign = (basis: "VIEWS" | "APPROVED_CLIPS", onchainId: string) =>
      db.campaign.create({ data: { campaignerId: camp.id, title: basis, story, contentSource: "LINK", platforms: ["YOUTUBE"], payoutMode: "POOL_SHARE", poolShareBasis: basis, poolSize: 1000, status: "APPROVED", onchainId } });
    const views = await mkCampaign("VIEWS", "51");
    const clips = await mkCampaign("APPROVED_CLIPS", "52");
    for (const c of [views, clips]) {
      const spec: [typeof u1, string, number, "APPROVE" | "REJECT"][] = [[u1, "a", 9000, "APPROVE"], [u1, "b", 1000, "APPROVE"], [u2, "c", 10000, "APPROVE"], [u2, "d", 50000, "REJECT"]];
      for (const [u, vid, v, res] of spec) {
        const ch = (await db.channel.findFirst({ where: { userId: u.id } })) ?? (await db.channel.create({ data: { userId: u.id, platform: "YOUTUBE", handle: `ps-${u.id.slice(-4)}`, verificationCode: "x", verified: true } }));
        const s = await db.submission.create({ data: { campaignId: c.id, creatorId: u.id, channelId: ch.id, link: `https://youtu.be/${c.title}${vid}`, videoId: `${c.title}${vid}`, metadata: {}, verdict: { create: { result: res, confidence: 0.9, reason: "r" } } } });
        await db.viewSnapshot.create({ data: { campaignId: c.id, submissionId: s.id, creatorId: u.id, day, cumulativeViews: v } });
      }
    }
    const { GET } = await import("@/app/api/campaigns/[id]/pool-share/route");
    const byViews = (await j(await GET(req(`/api/campaigns/${views.id}/pool-share`, W.camp), ctx(views.id)))).body;
    expect(byViews.basis).toBe("VIEWS");
    expect(Object.fromEntries(byViews.weights.map((w: { creatorWallet: string; weight: number }) => [w.creatorWallet, w.weight]))).toEqual({ [W.cre1]: 10000, [W.cre2]: 10000 }); // rejected clip's views never count
    expect(byViews.onchain).toEqual({ functionName: "setWeights", args: { id: "51", creators: [W.cre1, W.cre2], weights: ["10000", "10000"] } });
    const byClips = (await j(await GET(req(`/api/campaigns/${clips.id}/pool-share`, W.adm), ctx(clips.id)))).body;
    expect(byClips.basis).toBe("APPROVED_CLIPS");
    expect(Object.fromEntries(byClips.weights.map((w: { creatorWallet: string; weight: number }) => [w.creatorWallet, w.weight]))).toEqual({ [W.cre1]: 2, [W.cre2]: 1 });
    expect(byClips.weights.reduce((n: number, w: { share: number }) => n + w.share, 0)).toBeCloseTo(1);
    expect((await j(await GET(req(`/api/campaigns/${views.id}/pool-share`, W.cre1), ctx(views.id)))).status).toBe(403);
    const pv = await db.campaign.findFirstOrThrow({ where: { payoutMode: "PER_VIEW" } });
    expect((await j(await GET(req(`/api/campaigns/${pv.id}/pool-share`, W.camp), ctx(pv.id)))).status).toBe(409);
  });
});

describe("PRD 4.10 / 4.11 optional modules are off by default; out-of-scope items are absent", () => {
  it("every optional-module route answers 404 FEATURE_DISABLED with the flags unset", async () => {
    const ladder = await import("@/app/api/status/ladder/route");
    const links = await import("@/app/api/referral/links/route");
    const summary = await import("@/app/api/referral/summary/route");
    const profile = await import("@/app/api/creator/onchain-profile/route");
    const calls: [string, (r: Request) => Promise<Response>][] = [
      ["/api/status/ladder", ladder.GET],
      ["/api/referral/links", links.GET],
      ["/api/referral/summary", summary.GET],
      ["/api/creator/onchain-profile", profile.GET],
    ];
    for (const [url, fn] of calls) {
      const r = await j(await fn(req(url, W.cre1)));
      expect([r.status, r.body.error.code]).toEqual([404, "FEATURE_DISABLED"]);
    }
  });

  it("no Radar Room / Jobs / bank cash-out / AI-citation monitoring routes, no AI-agent creator role", async () => {
    const apiDir = path.resolve(import.meta.dirname, "../app/api");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? [path.join(d, n), ...walk(path.join(d, n))] : []));
    const names = walk(apiDir).map((p) => path.relative(apiDir, p).replace(/\\/g, "/").toLowerCase());
    for (const banned of ["radar", "cashout", "cash-out", "withdraw", "offramp", "bank", "monitor", "citation", "scribble"]) {
      expect(names.filter((n) => n.includes(banned))).toEqual([]);
    }
    expect(names.filter((n) => /(^|\/)jobs(\/|$)/.test(n) && !n.startsWith("ai-video"))).toEqual([]); // First Dollar "Jobs"
    const schema = readFileSync(path.resolve(import.meta.dirname, "../../prisma/schema.prisma"), "utf8");
    expect(/enum Role \{([^}]*)\}/.exec(schema)![1].split(/\s+/).filter(Boolean)).toEqual(["CAMPAIGNER", "CREATOR", "ADMIN"]);
    const { POST } = await import("@/app/api/auth/session/route");
    const r = await j(await POST(req("/api/auth/session", undefined, { wallet: "0x4444444444444444444444444444444444440004", role: "AGENT" })));
    expect(r.status).toBe(400);
    expect(existsSync(path.resolve(import.meta.dirname, "../app/api/onramp/session"))).toBe(true); // on-ramp only
  });
});
