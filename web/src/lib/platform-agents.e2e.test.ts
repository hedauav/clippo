import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setOverride } from "./config";
import { clearDoubles, FakePlatform, installChainDouble, installDoubles } from "../test/doubles";
import { parseXPostId } from "./platforms/x";

// End-to-end test of the platform/source/AI-video/appeal/deal/assistant routes. Runs handlers directly against the throwaway test DB (see src/test/global-setup.ts).
process.env.ALLOW_WALLET_HEADER = "true";
process.env.STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), "clippo-e2e-"));

const as = (wallet: string, body?: unknown, init: RequestInit = {}) =>
  new Request("http://x/api", { method: body === undefined ? "GET" : "POST", headers: { "x-wallet": wallet, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), ...init });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const j = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });

beforeAll(() => {
  installDoubles();
  installChainDouble({ getCampaign: async () => ({ state: 2, campaignerFeeBps: 25, creatorFeeBps: 25, highValue: false }) as never });
});
afterAll(clearDoubles);

describe("platform-agents e2e", () => {
  it("covers X channel/submissions, source, AI video gate, appeals, deals, assistants", async () => {
    const { db } = await import("./db");
    const mk = (role: "CAMPAIGNER" | "CREATOR" | "ADMIN", wallet: string) => db.user.upsert({ where: { wallet }, update: {}, create: { role, wallet, verified: true } });
    const camp = await mk("CAMPAIGNER", "0xcamp");
    const cre = await mk("CREATOR", "0xcre");
    await mk("ADMIN", "0xadm");
    const story = { summary: "Promote Ledgerlane close tool", topic: "Ledgerlane accounting close", requiredPoints: ["closes the books"], prohibitedClaims: ["risk-free"], disclosureLabel: "sponsored", attribution: "" };
    const campaign = await db.campaign.create({
      data: { campaignerId: camp.id, title: "Smoke", story, contentSource: "AI_GENERATED", platforms: ["YOUTUBE", "X", "INSTAGRAM"], payoutMode: "PER_VIEW", poolSize: 1000, ratePer1k: 2.4, status: "DRAFT" },
    });

    // --- AI video ---
    const jobs = await import("../app/api/ai-video/jobs/route");
    const jobGet = await import("../app/api/ai-video/jobs/[id]/route");
    const jobApprove = await import("../app/api/ai-video/jobs/[id]/approve/route");
    const jobVideo = await import("../app/api/ai-video/jobs/[id]/video/route");
    const src = await import("../app/api/campaigns/[id]/source/route");
    const approveC = await import("../app/api/campaigns/[id]/approve/route");

    expect((await j(await jobs.POST(as("0xcamp", { prompt: "a nice product demo video", rightsConfirmed: false })))).status).toBe(400);
    const created = await j(await jobs.POST(as("0xcamp", { prompt: "a nice product demo video", rightsConfirmed: true })));
    expect(created.status).toBe(201);
    expect(created.body.job.label).toBe("AI-GENERATED");
    const jobId = created.body.job.id as string;
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "FUNDED", onchainId: "11" } });
    const att = await j(await src.POST(as("0xcamp", { jobId }), ctx(campaign.id))); // not DRAFT now
    expect(att.status).toBe(409);
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "DRAFT" } });
    expect((await j(await src.POST(as("0xcamp", { jobId }), ctx(campaign.id)))).status).toBe(200);
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "FUNDED", onchainId: "11" } });
    const blocked = await j(await approveC.POST(as("0xadm", {}), ctx(campaign.id)));
    expect(blocked.status).toBe(409);
    const polled = await j(await jobGet.GET(as("0xcamp"), ctx(jobId)));
    expect(polled.body.job.status).toBe("ready");
    expect((await j(await approveC.POST(as("0xadm", {}), ctx(campaign.id)))).body.error.code).toBe("SOURCE_NOT_APPROVED");
    expect((await j(await jobApprove.POST(as("0xcamp", {}), ctx(jobId)))).body.job.status).toBe("approved");
    const live = await j(await approveC.POST(as("0xadm", {}), ctx(campaign.id)));
    expect(live.status).toBe(200);
    const vid = await jobVideo.GET(as("0xcre", undefined, { headers: { "x-wallet": "0xcre", range: "bytes=0-7" } }), ctx(jobId));
    expect(vid.status).toBe(206);
    expect(vid.headers.get("x-clippo-ai-generated")).toBe("true");

    // --- upload ---
    const up = await import("../app/api/uploads/route");
    const upFile = await import("../app/api/uploads/[id]/file/route");
    const mp4 = new Uint8Array(64);
    mp4.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const fd = new FormData();
    fd.append("file", new File([mp4], "my clip.mp4", { type: "video/mp4" }));
    const u = await j(await up.POST(as("0xcamp", fd)));
    expect(u.status).toBe(201);
    const fd2 = new FormData();
    fd2.append("file", new File([new Uint8Array(10)], "evil.mp4", { type: "video/mp4" }));
    expect((await j(await up.POST(as("0xcamp", fd2)))).status).toBe(415);
    expect((await upFile.GET(as("0xcamp"), ctx(u.body.upload.id))).status).toBe(200);
    expect((await upFile.GET(as("0xcre"), ctx(u.body.upload.id))).status).toBe(404); // not attached to an open campaign

    // --- link-a-video ---
    const c2 = await db.campaign.create({ data: { campaignerId: camp.id, title: "L", story, contentSource: "LINK", platforms: ["X"], payoutMode: "PER_VIEW", poolSize: 100, ratePer1k: 2, status: "DRAFT" } });
    expect((await j(await src.POST(as("0xcamp", { url: "javascript:alert(1)" }), ctx(c2.id)))).status).toBe(400);
    expect((await j(await src.POST(as("0xcamp", { url: "https://example.com/v.mp4" }), ctx(c2.id)))).body.campaign.contentUrl).toBe("https://example.com/v.mp4");

    // --- X channel + submissions ---
    const chans = await import("../app/api/channels/route");
    const verify = await import("../app/api/channels/[id]/verify/route");
    const subs = await import("../app/api/submissions/route");
    const ch = await j(await chans.POST(as("0xcre", { platform: "X", handle: "@Smoker" })));
    expect(ch.status).toBe(201);
    expect((await j(await verify.POST(as("0xcre", {}), ctx(ch.body.channel.id)))).body.channel.verified).toBe(true);
    const ok1 = await j(await subs.POST(as("0xcre", { campaignId: campaign.id, channelId: ch.body.channel.id, link: "https://x.com/smoker/status/1231?mock_transcript=Sponsored%20Ledgerlane%20accounting%20close%20closes%20the%20books" })));
    const unread = await j(await subs.POST(as("0xcre", { campaignId: campaign.id, channelId: ch.body.channel.id, link: "https://x.com/smoker/status/1230" })));
    expect(unread.body.verdict.result).toBe("NEEDS_HUMAN");
    const bad = await j(await subs.POST(as("0xcre", { campaignId: campaign.id, channelId: ch.body.channel.id, link: "https://x.com/smoker/status/1239" })));
    expect(bad.body.verdict.result).toBe("REJECT");

    // --- appeals ---
    const appeal = await import("../app/api/submissions/[id]/appeal/route");
    const verdict = await import("../app/api/submissions/[id]/verdict/route");
    const esc = await import("../app/api/appeals/[id]/escalate/route");
    const appeals = await import("../app/api/appeals/route");
    const notes = await import("../app/api/notifications/route");
    const ap = await j(await appeal.POST(as("0xcre", { note: "I did say it" }), ctx(bad.body.submission.id)));
    expect(ap.status).toBe(200);
    const aid = ap.body.appeal.id as string;
    expect((await j(await notes.GET(as("0xcamp")))).body.notifications.some((n: { type: string }) => n.type === "APPEAL_OPENED")).toBe(true);
    expect((await j(await verdict.POST(as("0xadm", { result: "APPROVE", reason: "x" }), ctx(bad.body.submission.id)))).body.error.code).toBe("CAMPAIGNER_FIRST");
    const up1 = await j(await verdict.POST(as("0xcamp", { result: "REJECT", reason: "stays rejected" }), ctx(bad.body.submission.id)));
    expect(up1.body.verdict.appealStatus).toBe("UPHELD");
    const e = await j(await esc.POST(as("0xcre", {}), ctx(aid)));
    expect(e.body.appeal.stage).toBe("ADMIN");
    expect((await j(await verdict.POST(as("0xcamp", { result: "APPROVE", reason: "x" }), ctx(bad.body.submission.id)))).body.error.code).toBe("ESCALATED");
    const fin = await j(await verdict.POST(as("0xadm", { result: "APPROVE", reason: "admin overturned" }), ctx(bad.body.submission.id)));
    expect(fin.body.verdict.appealStatus).toBe("OVERTURNED");
    expect((await j(await appeals.GET(as("0xcre")))).body.appeals[0].status).toBe("OVERTURNED");
    expect((await j(await notes.GET(as("0xcre")))).body.notifications.map((n: { type: string }) => n.type)).toContain("APPEAL_OVERTURNED");

    // --- deals ---
    const deal = await import("../app/api/campaigns/[id]/deal/route");
    const limits = await import("../app/api/campaigns/[id]/deal/limits/route");
    const accept = await import("../app/api/campaigns/[id]/deal/accept/route");
    expect((await j(await limits.POST(as("0xcamp", { minRate: 1.2, maxRate: 3.6, autoAcceptUpTo: 2.8 }), ctx(campaign.id)))).status).toBe(200);
    expect((await j(await deal.POST(as("0xcre", { rate: 9 }), ctx(campaign.id)))).body.error.code).toBe("OUTSIDE_LIMITS");
    const d1 = await j(await deal.POST(as("0xcre", { rate: 3.4, minRate: 2 }), ctx(campaign.id)));
    expect(d1.body.deal.offers.at(-1)).toMatchObject({ by: "negotiator", rate: 3.1 });
    const d1b = await j(await accept.POST(as("0xcre", {}), ctx(campaign.id)));
    expect(d1b.body.deal.status).not.toBe("ACCEPTED");
    const d1c = await j(await accept.POST(as("0xcamp", { creatorId: cre.id }), ctx(campaign.id)));
    expect(d1c.body.deal.status).toBe("ACCEPTED");
    expect(d1c.body.deal.acceptedRate).toBe(3.1);

    // --- assistants ---
    const ex = await import("../app/api/assistant/creator/explain/route");
    const chk = await import("../app/api/assistant/creator/check/route");
    const mt = await import("../app/api/assistant/creator/matches/route");
    const ds = await import("../app/api/assistant/admin/disputes/route");
    const gr = await import("../app/api/assistant/admin/growth/route");
    const hold = await import("../app/api/assistant/admin/growth/[id]/hold/route");
    const aeo = await import("../app/api/wizard/aeo/route");
    expect((await j(await ex.POST(as("0xcre", { campaignId: campaign.id })))).body.explanation.doList).toEqual(["closes the books"]);
    expect((await j(await chk.POST(as("0xcre", { campaignId: campaign.id, caption: "risk-free!" })))).body.riskLevel).toBe("HIGH");
    expect((await j(await mt.GET(as("0xcre")))).status).toBe(200);
    expect(Array.isArray((await j(await ds.GET(as("0xadm")))).body.disputes)).toBe(true);
    expect((await j(await gr.GET(as("0xadm")))).status).toBe(200);
    expect((await j(await hold.POST(as("0xadm", { held: true }), ctx(ok1.body.submission?.id ?? bad.body.submission.id)))).body.held).toBe(true);
    expect((await j(await hold.POST(as("0xadm", { held: false }), ctx(ok1.body.submission?.id ?? bad.body.submission.id)))).body.held).toBe(false);
    const a = await j(await aeo.POST(as("0xcamp", { story })));
    expect(a.body.aeo.faq.length).toBeGreaterThan(0);

    // --- X review path: real X without access -> channel review ---
    setOverride("x", null); // use the real X adapter (stubbed network)
    process.env.X_BEARER_TOKEN = "t";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    const ch2 = await j(await chans.POST(as("0xcre", { platform: "X", handle: "other" })));
    const rv = await j(await verify.POST(as("0xcre", {}), ctx(ch2.body.channel.id)));
    globalThis.fetch = realFetch;
    delete process.env.X_BEARER_TOKEN;
    setOverride("x", new FakePlatform("X", parseXPostId));
    expect(rv.status).toBe(202);
    expect(rv.body.review).toBe(true);
    const review = await import("../app/api/channels/[id]/review/route");
    expect((await j(await review.POST(as("0xadm", { approve: true }), ctx(ch2.body.channel.id)))).body.channel.verified).toBe(true);
  }, 60000);
});
