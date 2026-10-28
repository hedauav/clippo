/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers parse untyped JSON responses */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { budgetTotals, fundAllPlan, priceFromCard, rateCardSchema } from "./money";
import { computeStats, isHigherRanked, nextTier } from "./rank";
import { costPer1k, estimateShares, trendScore } from "./marketplace";

import { GET as dirGET } from "@/app/api/creators/route";
import { PUT as profilePUT } from "@/app/api/creators/profile/route";
import { POST as briefPOST } from "@/app/api/briefs/route";
import { POST as slPOST } from "@/app/api/shortlists/route";
import { POST as slAdd } from "@/app/api/shortlists/[id]/creators/route";
import { GET as slShared } from "@/app/api/shortlists/shared/[token]/route";
import { POST as hirePOST } from "@/app/api/hires/route";
import { GET as hireGET } from "@/app/api/hires/[id]/route";
import { POST as hireAdd } from "@/app/api/hires/[id]/creators/route";
import { PATCH as hirePatch } from "@/app/api/hires/[id]/creators/[creatorId]/route";
import { POST as hireFund } from "@/app/api/hires/[id]/fund/route";
import { GET as hirePreset } from "@/app/api/hires/[id]/split-preset/route";
import { GET as hireShared } from "@/app/api/hires/shared/[token]/route";
import { GET as trendingGET } from "@/app/api/marketplace/trending/route";
import { GET as leaderGET } from "@/app/api/leaderboard/route";
import { GET as campDash } from "@/app/api/dashboard/campaigner/route";
import { GET as creatorDash } from "@/app/api/dashboard/creator/route";
import { GET as eligGET } from "@/app/api/campaigns/[id]/eligibility/route";

describe("rank", () => {
  it("computes tiers from approved clips and reliability", () => {
    expect(computeStats(0, 0).tier).toBe("NEW");
    expect(computeStats(2, 0).tier).toBe("NEW");
    expect(computeStats(3, 0).tier).toBe("RISING");
    expect(computeStats(3, 3).tier).toBe("NEW"); // reliability 0.5 < 0.6
  });
  it("PRO and ELITE thresholds", () => {
    expect(computeStats(10, 2).tier).toBe("PRO");
    expect(computeStats(10, 5).tier).toBe("RISING");
    expect(computeStats(25, 4).tier).toBe("ELITE");
    expect(computeStats(25, 5).tier).toBe("PRO");
  });
  it("higher-ranked = RISING or better; next tier hint", () => {
    expect(isHigherRanked(computeStats(2, 0))).toBe(false);
    expect(isHigherRanked(computeStats(3, 0))).toBe(true);
    expect(nextTier(computeStats(1, 0))).toEqual({ tier: "RISING", needApproved: 2, needReliability: 0.6 });
    expect(nextTier(computeStats(30, 0))).toBeNull();
  });
});

describe("money helpers", () => {
  it("rolls up budget by status", () => {
    const t = budgetTotals([
      { status: "APPROVED", amount: 100 },
      { status: "APPROVED", amount: 50.5 },
      { status: "PROPOSED", amount: 20 },
      { status: "REJECTED", amount: 5 },
    ]);
    expect(t).toMatchObject({ approvedTotal: 150.5, proposedTotal: 20, rejectedTotal: 5, approvedCount: 2 });
  });
  it("prices from rate card and builds fund-all plan", () => {
    const card = rateCardSchema.parse([{ label: "Short", price: 40 }]);
    expect(priceFromCard(card, "short", 3)).toBe(120);
    expect(() => priceFromCard(card, "nope", 1)).toThrow();
    const plan = fundAllPlan([
      { wallet: "0xa", amount: 10, status: "APPROVED" },
      { wallet: "0xb", amount: 99, status: "PROPOSED" },
    ]);
    expect(plan).toEqual({ poolSize: 10, splits: [{ creatorWallet: "0xa", amount: 10 }] });
  });
  it("rejects duplicate rate labels", () => {
    expect(rateCardSchema.safeParse([{ label: "A", price: 1 }, { label: "a", price: 2 }]).success).toBe(false);
  });
});

describe("marketplace math", () => {
  it("estimates PER_VIEW with pool cap and POOL_SHARE", () => {
    const perView = { payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 10, poolShareBasis: null } as const;
    const e = estimateShares(perView, [
      { creatorId: "a", views: 3000 },
      { creatorId: "b", views: 7000 },
    ]); // raw 6 + 14 = 20 > 10 => scale 0.5
    expect(e.get("a")).toBe(3);
    expect(e.get("b")).toBe(7);
    const pool = { payoutMode: "POOL_SHARE", ratePer1k: null, poolSize: 100, poolShareBasis: "VIEWS" } as const;
    expect(estimateShares(pool, [{ creatorId: "a", views: 1 }, { creatorId: "b", views: 3 }]).get("b")).toBe(75);
    expect(estimateShares({ ...perView, payoutMode: "HUMAN_SPLIT" }, [{ creatorId: "a", views: 1 }]).size).toBe(0);
  });
  it("trend score and cost per 1k", () => {
    expect(trendScore({ viewsGained: 1000, approvedClips: 2, recentSubmissions: 4 })).toBe(1300);
    expect(costPer1k(50, 10000)).toBe(5);
    expect(costPer1k(50, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------- integration (throwaway DB)
const run = Math.random().toString(36).slice(2, 8);
const W = {
  camp: `0xcamp${run}`,
  camp2: `0xcamptwo${run}`,
  a: `0xaaa${run}`,
  b: `0xbbb${run}`,
  c: `0xccc${run}`,
  newbie: `0xnew${run}`,
};
const ids: Record<string, string> = {};

function call<P>(handler: (req: Request, ctx: P) => Promise<Response>, wallet: string | null, opts: { method?: string; url?: string; body?: unknown; params?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (wallet) headers["x-wallet"] = wallet;
  const req = new Request(opts.url ?? "http://t/api", {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return handler(req, { params: Promise.resolve(opts.params ?? {}) } as P).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}

async function mkUser(wallet: string, role: "CAMPAIGNER" | "CREATOR", verified: boolean) {
  return db.user.create({ data: { wallet, role, verified } });
}

/** Seed `n` approved and `rej` rejected clips for a creator in a campaign; returns first approved submission id. */
async function seedClips(campaignId: string, creatorId: string, channelId: string, approved: number, rejected: number, views: number) {
  let first = "";
  for (let i = 0; i < approved + rejected; i++) {
    const isApproved = i < approved;
    const s = await db.submission.create({
      data: {
        campaignId,
        creatorId,
        channelId,
        link: `https://youtu.be/${creatorId}${i}`,
        videoId: `${creatorId}-${campaignId}-${i}`,
        metadata: {},
        verdict: { create: { result: isApproved ? "APPROVE" : "REJECT", confidence: 0.9, reason: "t" } },
      },
    });
    if (isApproved) {
      if (!first) first = s.id;
      await db.viewSnapshot.create({
        data: { campaignId, submissionId: s.id, creatorId, day: new Date().toISOString().slice(0, 10), cumulativeViews: views },
      });
    }
  }
  return first;
}

describe("creator workspace (integration)", () => {
  beforeAll(async () => {
    ids.camp = (await mkUser(W.camp, "CAMPAIGNER", true)).id;
    ids.camp2 = (await mkUser(W.camp2, "CAMPAIGNER", false)).id;
    for (const k of ["a", "b", "c", "newbie"] as const) {
      ids[k] = (await mkUser(W[k], "CREATOR", k !== "newbie")).id;
      await db.channel.create({
        data: { userId: ids[k], platform: "YOUTUBE", handle: `h${k}${run}`, verificationCode: "x", verified: true },
      });
    }
  });

  it("directory lists only vetted creators; supports search and filters", async () => {
    const rc = (price: number) => [{ label: "Short", price }, { label: "Long", platform: "YOUTUBE", price: price * 3 }];
    expect((await call(profilePUT, W.a, { method: "PUT", body: { displayName: "Alpha Tech", niches: ["tech"], rateCard: rc(100) } })).status).toBe(200);
    await call(profilePUT, W.b, { method: "PUT", body: { displayName: "Bravo Cook", niches: ["food"], rateCard: rc(40) } });
    await call(profilePUT, W.newbie, { method: "PUT", body: { displayName: "Unverified", niches: ["tech"], rateCard: rc(10) } });
    // campaigner cannot create profile
    expect((await call(profilePUT, W.camp, { method: "PUT", body: { displayName: "x", rateCard: rc(1) } })).status).toBe(403);
    expect((await call(profilePUT, W.a, { method: "PUT", body: { displayName: "x", rateCard: [] } })).status).toBe(400);

    // ranking: a is RISING (3 approved), b is NEW
    const campaign = await db.campaign.create({
      data: { campaignerId: ids.camp, title: "Seed", story: {}, contentSource: "LINK", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 1000, status: "APPROVED" },
    });
    ids.seedCampaign = campaign.id;
    const chA = (await db.channel.findFirst({ where: { userId: ids.a } }))!.id;
    ids.aClip = await seedClips(campaign.id, ids.a, chA, 3, 0, 5000);

    const all = await call(dirGET, null, { url: "http://t/api/creators" });
    const names = all.json.creators.map((c: any) => c.displayName);
    expect(names).toEqual(["Alpha Tech", "Bravo Cook"]); // tier order, unverified excluded
    expect(all.json.creators[0]).toMatchObject({ tier: "RISING", verifiedBadge: true, lowestRate: 100 });

    const q = await call(dirGET, null, { url: "http://t/api/creators?q=cook" });
    expect(q.json.creators).toHaveLength(1);
    expect((await call(dirGET, null, { url: "http://t/api/creators?tier=RISING" })).json.creators).toHaveLength(1);
    expect((await call(dirGET, null, { url: "http://t/api/creators?maxRate=50" })).json.creators[0].displayName).toBe("Bravo Cook");
    expect((await call(dirGET, null, { url: "http://t/api/creators?niche=tech&platform=YOUTUBE" })).json.creators).toHaveLength(1);
    expect((await call(dirGET, null, { url: "http://t/api/creators?sort=rate" })).json.creators[0].displayName).toBe("Bravo Cook");
    expect((await call(dirGET, null, { url: "http://t/api/creators?tier=BOGUS" })).status).toBe(400);
  });

  it("shortlists are shareable via a public token", async () => {
    const created = await call(slPOST, W.camp, { method: "POST", body: { title: "Tech picks", creatorIds: [ids.a] } });
    expect(created.status).toBe(201);
    const { id, shareToken } = created.json.shortlist;
    await call(slAdd, W.camp, { method: "POST", params: { id }, body: { creatorId: ids.b, note: "cheap" } });
    expect((await call(slAdd, W.camp2, { method: "POST", params: { id }, body: { creatorId: ids.b } })).status).toBe(403);
    const shared = await call(slShared, null, { params: { token: shareToken } });
    expect(shared.status).toBe(200);
    expect(shared.json.creators.map((c: any) => c.displayName).sort()).toEqual(["Alpha Tech", "Bravo Cook"]);
    expect(shared.json.shortlist.shareToken).toBeUndefined();
    expect((await call(slShared, null, { params: { token: "nope" } })).status).toBe(404);
    ids.shortlist = id;
  });

  let hireId = "";
  let shareToken = "";

  it("hire: brief, creator-set rates, approvals with live budget total", async () => {
    const brief = await call(briefPOST, W.camp, {
      method: "POST",
      body: { title: "Launch", story: { summary: "s", topic: "t" }, deliverables: ["1 short"], platforms: ["YOUTUBE"], deadline: "2030-01-01" },
    });
    expect(brief.status).toBe(201);
    const hire = await call(hirePOST, W.camp, { method: "POST", body: { title: "Launch hire", briefId: brief.json.brief.id } });
    expect(hire.status).toBe(201);
    hireId = hire.json.hire.id;
    shareToken = hire.json.hire.shareToken;
    const p = { id: hireId };

    const bad = await call(hireAdd, W.camp, { method: "POST", params: p, body: { creatorId: ids.a, rateLabel: "Nonexistent" } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("BAD_RATE");

    const add = await call(hireAdd, W.camp, { method: "POST", params: p, body: { creatorId: ids.a, rateLabel: "Long", quantity: 2 } });
    expect(add.json.budget).toMatchObject({ approvedTotal: 0, proposedTotal: 600 });
    await call(hireAdd, W.camp, { method: "POST", params: p, body: { creatorId: ids.b, rateLabel: "Short" } });

    const patch = (cid: string, status: string) =>
      call(hirePatch, W.camp, { method: "PATCH", params: { id: hireId, creatorId: cid }, body: { status } });
    expect((await patch(ids.a, "APPROVED")).json.budget).toMatchObject({ approvedTotal: 600, proposedTotal: 40 });
    expect((await patch(ids.b, "APPROVED")).json.budget).toMatchObject({ approvedTotal: 640, approvedCount: 2 });
    expect((await patch(ids.b, "REJECTED")).json.budget).toMatchObject({ approvedTotal: 600, rejectedTotal: 40 });
    expect((await patch(ids.b, "APPROVED")).json.budget.approvedTotal).toBe(640);
    expect((await patch(ids.c, "APPROVED")).status).toBe(404);
    // other campaigner can't touch it
    expect((await call(hirePatch, W.camp2, { method: "PATCH", params: { id: hireId, creatorId: ids.a }, body: { status: "REJECTED" } })).status).toBe(403);
  });

  it("shared read-only view and creator view, with no token leak", async () => {
    const shared = await call(hireShared, null, { params: { token: shareToken } });
    expect(shared.status).toBe(200);
    expect(shared.json.budget.approvedTotal).toBe(640);
    expect(shared.json.hire.shareToken).toBeUndefined();
    expect(shared.json.creators).toHaveLength(2);
    expect(shared.json.brief.title).toBe("Launch");

    const asCreator = await call(hireGET, W.a, { params: { id: hireId } });
    expect(asCreator.status).toBe(200);
    expect(asCreator.json.creators).toHaveLength(2); // same shared view for both sides
    expect(asCreator.json.budget.approvedTotal).toBe(640);
    expect(asCreator.json.hire.shareToken).toBeUndefined();
    expect((await call(hireGET, W.c, { params: { id: hireId } })).status).toBe(403);
    expect((await call(hireGET, W.camp, { params: { id: hireId } })).json.hire.shareToken).toBe(shareToken);
  });

  it("fund all -> one HUMAN_SPLIT campaign with preset amounts; locks creators", async () => {
    expect((await call(hireFund, W.camp2, { method: "POST", params: { id: hireId } })).status).toBe(403);
    const res = await call(hireFund, W.camp, { method: "POST", params: { id: hireId } });
    expect(res.status).toBe(201);
    expect(res.json.campaign).toMatchObject({ payoutMode: "HUMAN_SPLIT", approver: "CAMPAIGNER_ONLY", poolSize: 640, status: "DRAFT", eligibility: "ANYONE_VERIFIED" });
    expect(res.json.fundingIntent.presetSplits).toEqual(
      expect.arrayContaining([
        { creatorWallet: W.a, amount: 600 },
        { creatorWallet: W.b, amount: 40 },
      ]),
    );
    ids.hireCampaign = res.json.campaign.id;
    expect((await call(hireFund, W.camp, { method: "POST", params: { id: hireId } })).status).toBe(409);
    expect((await call(hireAdd, W.camp, { method: "POST", params: { id: hireId }, body: { creatorId: ids.c, rateLabel: "Short" } })).status).toBe(409);
  });

  it("fund-all needs a brief and an approved creator", async () => {
    const h = await call(hirePOST, W.camp, { method: "POST", body: { title: "Empty" } });
    expect((await call(hireFund, W.camp, { method: "POST", params: { id: h.json.hire.id } })).json.error.code).toBe("BRIEF_REQUIRED");
    const brief = await call(briefPOST, W.camp, { method: "POST", body: { title: "b", story: { summary: "s", topic: "t" } } });
    const h2 = await call(hirePOST, W.camp, { method: "POST", body: { title: "E2", briefId: brief.json.brief.id, shortlistId: ids.shortlist } });
    expect(h2.json.creators).toHaveLength(2); // seeded from shortlist, PROPOSED
    expect(h2.json.budget.approvedTotal).toBe(0);
    expect((await call(hireFund, W.camp, { method: "POST", params: { id: h2.json.hire.id } })).json.error.code).toBe("NO_APPROVED_CREATORS");
  });

  it("restricts submissions to hired creators and tracks per creator; preset split after approved clip", async () => {
    const campaign = (await db.campaign.findUnique({ where: { id: ids.hireCampaign } }))!;
    expect((await call(eligGET, W.a, { params: { id: campaign.id } })).json).toMatchObject({ eligible: true, restrictedToHiredCreators: true });
    const out = await call(eligGET, W.c, { params: { id: campaign.id } });
    expect(out.json.eligible).toBe(false);
    expect(out.json.reasons).toContain("NOT_HIRED");

    await db.campaign.update({ where: { id: campaign.id }, data: { status: "APPROVED" } });
    expect((await call(hirePreset, W.camp, { params: { id: hireId } })).json).toMatchObject({ splits: [], waiting: expect.any(Array) });

    const chB = (await db.channel.findFirst({ where: { userId: ids.b } }))!.id;
    await seedClips(campaign.id, ids.b, chB, 1, 1, 2500);
    const preset = await call(hirePreset, W.camp, { params: { id: hireId } });
    expect(preset.json.splits).toEqual([{ creatorWallet: W.b, amount: 40 }]);
    expect(preset.json.waiting).toHaveLength(1);

    const view = await call(hireGET, W.camp, { params: { id: hireId } });
    const b = view.json.creators.find((c: any) => c.creatorId === ids.b);
    expect(b.tracking).toMatchObject({ approvedClips: 1, rejectedClips: 1, views: 2500 });
    expect(view.json.hire.campaignStatus).toBe("APPROVED");
  });

  it("HIGHER_RANKED eligibility follows the tier rule", async () => {
    const c = await db.campaign.create({
      data: { campaignerId: ids.camp, title: "Elite only", story: {}, contentSource: "LINK", platforms: ["YOUTUBE"], payoutMode: "POOL_SHARE", poolShareBasis: "VIEWS", poolSize: 100, eligibility: "HIGHER_RANKED", status: "APPROVED" },
    });
    const a = await call(eligGET, W.a, { params: { id: c.id } });
    expect(a.json).toMatchObject({ eligible: true, creatorTier: "RISING", requiredTier: "RISING" });
    const b = await call(eligGET, W.b, { params: { id: c.id } });
    expect(b.json.eligible).toBe(false);
    expect(b.json.reasons).toContain("NOT_ELIGIBLE");
  });

  it("trending, leaderboard, and dashboards", async () => {
    const t = await call(trendingGET, null, { url: "http://t/api/marketplace/trending?limit=5" });
    expect(t.status).toBe(200);
    const seed = t.json.campaigns.find((c: any) => c.campaign.id === ids.seedCampaign);
    expect(seed).toMatchObject({ approvedClips: 3, totalViews: 15000, viewsGained: 15000 });
    expect(seed.campaigner.verifiedBadge).toBe(true);
    expect(t.json.campaigns[0].trendScore).toBeGreaterThanOrEqual(t.json.campaigns.at(-1).trendScore);

    const lb = await call(leaderGET, null, { url: "http://t/api/leaderboard?sort=earnings" });
    const a = lb.json.creators.find((c: any) => c.creatorId === ids.a);
    // seed: PER_VIEW $2/1k, 15000 views -> $30 (<$1000 pool); a's 3 clips of 5000 each = 15000 views
    expect(a).toMatchObject({ views: 15000, approvedClips: 3, estimatedEarnings: 30, verifiedBadge: true, tier: "RISING" });
    expect(lb.json.creators[0].position).toBe(1);

    const dash = await call(campDash, W.camp);
    const seedRow = dash.json.campaigns.find((c: any) => c.campaignId === ids.seedCampaign);
    expect(seedRow).toMatchObject({ budget: 1000, spend: 30, views: 15000, costPer1kViews: 2, remaining: 970 });
    expect(seedRow.clips).toMatchObject({ approved: 3, rejected: 0 });
    expect(dash.json.totals.rejectedClips).toBe(1); // b's rejected clip in the hire campaign
    expect(dash.json.totals.approvedClips).toBeGreaterThanOrEqual(4);
    expect((await call(campDash, W.a)).status).toBe(403);

    const cd = await call(creatorDash, W.a);
    expect(cd.json).toMatchObject({ verifiedBadge: true, rank: { tier: "RISING", approved: 3 } });
    expect(cd.json.totals).toMatchObject({ views: 15000, approvedClips: 3, activeHires: 1 });
    expect(cd.json.rank).toBeDefined();
    expect((await call(creatorDash, W.camp)).status).toBe(403);
  });
});
