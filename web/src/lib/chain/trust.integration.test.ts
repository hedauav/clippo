/**
 * Integration tests against the throwaway test Postgres (src/test/global-setup.ts; never a dev/prod DB):
 * SIWE sign-in, chain indexer, split approvals, high-value attestation, launch gate, anti-fraud freeze.
 * World ID / escrow reads / chain signer are injected test doubles (src/test/doubles.ts).
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearDoubles, installChainDouble, installDoubles } from "@/test/doubles";
import { resetDb } from "@/test/db";

process.env.ADMIN_WALLETS = "0xad00000000000000000000000000000000000001";
process.env.SESSION_SECRET = "test-secret";

type Db = typeof import("@/lib/db").db;
let db: Db;

const ADMIN = "0xad00000000000000000000000000000000000001";
const CAMPAIGNER = "0xca00000000000000000000000000000000000002";
const CREATOR = "0xc100000000000000000000000000000000000003";

const jsonReq = (url: string, wallet: string | null, body?: unknown, method = "POST") =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...(wallet ? { "x-wallet": wallet } : {}), host: "localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let n = 0;
const proof = (p = "good") => ({ nullifier_hash: `n-${++n}-${Math.random()}`, proof: p === "good" ? `proof-${n}-${Math.random()}` : p });

async function call(handler: (req: Request, c: ReturnType<typeof ctx>) => Promise<Response>, req: Request, id: string) {
  const res = await handler(req, ctx(id));
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function seed() {
  const [admin, campaigner, creator] = await Promise.all([
    db.user.create({ data: { wallet: ADMIN, role: "ADMIN" } }),
    db.user.create({ data: { wallet: CAMPAIGNER, role: "CAMPAIGNER" } }),
    db.user.create({ data: { wallet: CREATOR, role: "CREATOR", verified: true } }),
  ]);
  const channel = await db.channel.create({ data: { userId: creator.id, platform: "YOUTUBE", handle: "c", verificationCode: "x", verified: true } });
  return { admin, campaigner, creator, channel };
}

async function newCampaign(campaignerId: string, over: Record<string, unknown> = {}) {
  return db.campaign.create({
    data: {
      campaignerId,
      title: "t",
      story: {},
      contentSource: "LINK",
      platforms: ["YOUTUBE"],
      payoutMode: "HUMAN_SPLIT",
      approver: "CAMPAIGNER_AND_ADMIN",
      poolSize: 500,
      status: "APPROVED",
      onchainId: "1",
      ...over,
    } as never,
  });
}

async function approvedClip(campaignId: string, creatorId: string, channelId: string, videoId = "vid1") {
  return db.submission.create({
    data: {
      campaignId, creatorId, channelId, link: `https://youtu.be/${videoId}`, videoId, metadata: {},
      verdict: { create: { result: "APPROVE", confidence: 0.9, reason: "ok" } },
    },
  });
}

beforeAll(async () => {
  installDoubles();
  installChainDouble({ getCampaign: async () => ({ state: 2, campaignerFeeBps: 25, creatorFeeBps: 25, highValue: false }) as never });
  db = (await import("@/lib/db")).db;
  await resetDb(db);
}, 120_000);

afterAll(async () => {
  clearDoubles();
  await db?.$disconnect();
});

describe("SIWE sign-in", () => {
  it("accepts a valid signature once, rejects replay, wrong signer and wrong domain", async () => {
    const { issueNonce, buildSiweMessage, verifySiwe } = await import("@/lib/siwe");
    const acct = privateKeyToAccount(generatePrivateKey());
    const req = new Request("http://localhost/api/auth/nonce", { headers: { host: "localhost" } });
    const issued = await issueNonce(req);
    const message = buildSiweMessage({ address: acct.address, nonce: issued.nonce, domain: issued.domain, uri: issued.uri, chainId: issued.chainId });
    const signature = await acct.signMessage({ message });

    expect(await verifySiwe(req, message, signature)).toBe(acct.address.toLowerCase());
    await expect(verifySiwe(req, message, signature)).rejects.toMatchObject({ code: "NONCE_INVALID" });

    const other = privateKeyToAccount(generatePrivateKey());
    const i2 = await issueNonce(req);
    const m2 = buildSiweMessage({ address: acct.address, nonce: i2.nonce, domain: i2.domain, uri: i2.uri, chainId: i2.chainId });
    await expect(verifySiwe(req, m2, await other.signMessage({ message: m2 }))).rejects.toMatchObject({ code: "BAD_SIGNATURE" });

    const i3 = await issueNonce(req);
    const m3 = buildSiweMessage({ address: acct.address, nonce: i3.nonce, domain: "evil.example", uri: "https://evil.example", chainId: i3.chainId });
    await expect(verifySiwe(req, m3, await acct.signMessage({ message: m3 }))).rejects.toMatchObject({ code: "BAD_SIWE_MESSAGE" });
  });

  it("dev bypass works outside production only", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const ok = await POST(jsonReq("/api/auth/session", null, { wallet: "0xdev0000000000000000000000000000000000aa", role: "CREATOR" }));
    expect(ok.status).toBe(200);
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const denied = await POST(jsonReq("/api/auth/session", null, { wallet: "0xdev0000000000000000000000000000000000bb", role: "CREATOR" }));
      expect(denied.status).toBe(401);
      expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("SIGNATURE_REQUIRED");
    } finally {
      env.NODE_ENV = prev;
    }
  });
});

describe("chain indexer", () => {
  it("funds, approves, credits, claims and rejects from events only, idempotently", async () => {
    const { processLogs, metadataUriFor } = await import("@/lib/chain/indexer");
    const { toUnits } = await import("@/lib/chain/units");
    const s = await seed();
    const c = await db.campaign.create({
      data: { campaignerId: s.campaigner.id, title: "t", story: {}, contentSource: "LINK", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 2000 },
    });
    const onchain = { campaignerFeeBps: 25, creatorFeeBps: 25, highValue: true } as never;
    const deps = { reader: { getCampaign: async () => onchain, retention: async () => ({ retentionSeconds: 7 * 86400, highValueThreshold: 0n }) } as never, blockTime: async () => new Date("2026-01-01T00:00:00Z") };
    let idx = 0;
    const log = (eventName: string, args: Record<string, unknown>, tx = "0x" + "11".repeat(32)) => ({ eventName, args, transactionHash: tx, logIndex: idx++, blockNumber: 10n });

    const created = (wallet: string, gross = 2000, uri = metadataUriFor(c.id)) =>
      log("CampaignCreated", { campaignId: 7n, campaigner: wallet, mode: 0, grossFunded: toUnits(gross), campaignerFee: toUnits(gross * 0.0025), pool: toUnits(gross * 0.9975), requireAdminApproval: false, metadataURI: uri });

    // forged funding: wrong funder / wrong amount are NOT applied
    const bad1 = await processLogs([created("0x00000000000000000000000000000000000000ff")], deps);
    const bad2 = await processLogs([created(CAMPAIGNER, 1999, metadataUriFor(c.id))], deps);
    expect(bad1[0].applied).toBe(false);
    expect(bad2[0].applied).toBe(false);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DRAFT");

    const good = created(CAMPAIGNER);
    expect((await processLogs([good], deps))[0].applied).toBe(true);
    expect((await processLogs([good], deps))[0].reason).toBe("already processed");
    let row = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ status: "FUNDED", onchainId: "7", grossFunded: 2000, campaignerFeeBps: 25, highValue: true });

    await processLogs([log("CampaignApproved", { campaignId: 7n, admin: ADMIN, feeToTreasury: 5_000_000n })], deps);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("APPROVED");

    await processLogs([log("CreatorCredited", { campaignId: 7n, creator: CREATOR, amount: toUnits(50) })], deps);
    await processLogs([log("CreatorCredited", { campaignId: 7n, creator: CREATOR, amount: toUnits(10) })], deps);
    let payout = await db.payout.findFirstOrThrow({ where: { campaignId: c.id } });
    expect(payout.amount).toBe(60);
    expect(payout.releaseAt?.toISOString()).toBe("2026-01-08T00:00:00.000Z");

    await processLogs([log("Claimed", { campaignId: 7n, creator: CREATOR, gross: toUnits(60), fee: toUnits(0.15), net: toUnits(59.85) })], deps);
    payout = await db.payout.findFirstOrThrow({ where: { campaignId: c.id } });
    expect(payout).toMatchObject({ status: "CLAIMED", claimedAmount: 60 });

    // a later credit re-opens the aggregate payout
    await processLogs([log("CreatorCredited", { campaignId: 7n, creator: CREATOR, amount: toUnits(5) })], deps);
    payout = await db.payout.findFirstOrThrow({ where: { campaignId: c.id } });
    expect(payout).toMatchObject({ status: "PENDING", amount: 65, claimedAmount: 60 });

    await processLogs([log("CampaignClosed", { campaignId: 7n, by: CAMPAIGNER, refundedToCampaigner: 0n })], deps);
    row = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe("CLOSED");
  });
});

describe("HUMAN_SPLIT two-party approval", () => {
  it("needs both approvers with identical splits, a fresh proof each, and failures leave nothing done", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/split/route");
    const s = await db.user.findUniqueOrThrow({ where: { wallet: CREATOR } });
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const channel = await db.channel.findFirstOrThrow({ where: { userId: s.id } });
    const c = await newCampaign(campaigner.id);
    await approvedClip(c.id, s.id, channel.id, "split-clip");
    const split = [{ creatorWallet: CREATOR, amount: 100 }];
    const url = `/api/campaigns/${c.id}/split`;

    // cancelled / expired proofs: 403 and nothing stored
    for (const bad of ["cancelled", "expired"]) {
      const r = await call(POST, jsonReq(url, CAMPAIGNER, { splits: split, worldIdProof: proof(bad) }), c.id);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("WORLD_ID_DENIED");
    }
    expect(await db.splitProposal.count({ where: { campaignId: c.id } })).toBe(0);
    expect(await db.payout.count({ where: { campaignId: c.id } })).toBe(0);

    // already-used proof: 409, nothing stored
    const reused = proof();
    const { proofHashOf } = await import("@/lib/worldid/fresh");
    await db.usedProof.create({ data: { proofHash: proofHashOf(reused), userId: "someone", action: "clippo-approve-split" } });
    const rep = await call(POST, jsonReq(url, CAMPAIGNER, { splits: split, worldIdProof: reused }), c.id);
    expect(rep.status).toBe(409);
    expect(rep.body.error.code).toBe("PROOF_REUSED");

    // campaigner approves: pending, waiting for admin
    const p1 = proof();
    const a = await call(POST, jsonReq(url, CAMPAIGNER, { splits: split, worldIdProof: p1 }), c.id);
    expect(a.status).toBe(201);
    expect(a.body.proposal.status).toBe("PENDING");
    expect(a.body.proposal.awaiting).toEqual(["admin"]);
    expect(a.body.payouts).toEqual([]);
    expect(a.body.attestation).toMatch(/^0x[0-9a-f]{64}$/);

    // the exact same proof cannot be replayed (even by the admin)
    const replay = await call(POST, jsonReq(url, ADMIN, { splits: split, worldIdProof: p1 }), c.id);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("PROOF_REUSED");

    // same approver again with the same split is rejected
    const again = await call(POST, jsonReq(url, CAMPAIGNER, { splits: split, worldIdProof: proof() }), c.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_APPROVED");

    // admin proposes a DIFFERENT split: supersedes, campaigner approval is cleared
    const diff = await call(POST, jsonReq(url, ADMIN, { splits: [{ creatorWallet: CREATOR, amount: 90 }], worldIdProof: proof() }), c.id);
    expect(diff.body.proposal.approvals).toEqual({ campaigner: false, admin: true });
    expect(diff.body.proposal.status).toBe("PENDING");
    expect(await db.payout.count({ where: { campaignId: c.id } })).toBe(0);

    // campaigner matches the admin's split: finalized, payouts created
    const fin = await call(POST, jsonReq(url, CAMPAIGNER, { splits: [{ creatorWallet: CREATOR, amount: 90 }], worldIdProof: proof() }), c.id);
    // approvals complete: payouts are created ONLY by the indexer from the on-chain event, so the proposal awaits the chain
    expect(fin.body.proposal.status).toBe("AWAITING_CHAIN");
    expect(fin.body.payouts).toEqual([]);
    expect(fin.body.onchain.functionName).toBe("approveSplit");
    const props = await db.splitProposal.findMany({ where: { campaignId: c.id }, orderBy: { createdAt: "asc" } });
    expect(props.map((p) => p.status)).toEqual(["SUPERSEDED", "AWAITING_CHAIN"]);

    // exceeding the pool afterwards
    const over = await call(POST, jsonReq(url, CAMPAIGNER, { splits: [{ creatorWallet: CREATOR, amount: 9999 }], worldIdProof: proof() }), c.id);
    expect(over.body.error.code).toBe("EXCEEDS_POOL");
  });

  it("CAMPAIGNER_ONLY completes on a single approval", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/split/route");
    const creator = await db.user.findUniqueOrThrow({ where: { wallet: CREATOR } });
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const channel = await db.channel.findFirstOrThrow({ where: { userId: creator.id } });
    const c = await newCampaign(campaigner.id, { approver: "CAMPAIGNER_ONLY" });
    await approvedClip(c.id, creator.id, channel.id, "solo-clip");
    const r = await call(POST, jsonReq(`/api/campaigns/${c.id}/split`, CAMPAIGNER, { splits: [{ creatorWallet: CREATOR, amount: 50 }], worldIdProof: proof() }), c.id);
    expect(r.body.proposal.status).toBe("AWAITING_CHAIN");
    expect(r.body.proposal.awaiting).toEqual(["chain"]);
  });
});

describe("high-value approval attestation", () => {
  it("blocks approval until a fresh human confirmation exists", async () => {
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const c = await newCampaign(campaigner.id, { status: "FUNDED", highValue: true, payoutMode: "PER_VIEW", approver: null });
    const attest = (await import("@/app/api/campaigns/[id]/attest/route")).POST;
    const approve = (await import("@/app/api/campaigns/[id]/approve/route")).POST;

    const no = await call(approve, jsonReq(`/api/campaigns/${c.id}/approve`, ADMIN, {}), c.id);
    expect(no.status).toBe(428);
    expect(no.body.error.code).toBe("HUMAN_CONFIRMATION_REQUIRED");

    const cancelled = await call(attest, jsonReq(`/api/campaigns/${c.id}/attest`, ADMIN, { worldIdProof: proof("cancelled") }), c.id);
    expect(cancelled.status).toBe(403);
    expect((await call(approve, jsonReq(`/api/campaigns/${c.id}/approve`, ADMIN, {}), c.id)).status).toBe(428);

    const good = await call(attest, jsonReq(`/api/campaigns/${c.id}/attest`, ADMIN, { worldIdProof: proof() }), c.id);
    expect(good.status).toBe(201);
    expect(good.body.attestation).toMatch(/^0x[0-9a-f]{64}$/);
    await db.campaign.update({ where: { id: c.id }, data: { approvalAttestation: good.body.attestation } }); // what the indexer stores from HumanAttested

    const done = await call(approve, jsonReq(`/api/campaigns/${c.id}/approve`, ADMIN, {}), c.id);
    expect(done.status).toBe(200);
    expect(done.body.campaign.status).toBe("APPROVED");
  });

  it("fund preview exposes the fee; funding without an escrow is a loud 503 (no mirrored funding)", async () => {
    const { GET, POST } = await import("@/app/api/campaigns/[id]/fund/route");
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const c = await newCampaign(campaigner.id, { status: "DRAFT", onchainId: null, poolSize: 5000, payoutMode: "PER_VIEW", approver: null, ratePer1k: 2 });
    const prev = await call(GET, jsonReq(`/api/campaigns/${c.id}/fund`, CAMPAIGNER, undefined, "GET"), c.id);
    expect(prev.body.preview).toMatchObject({ campaignerFeeBps: 25, campaignerFee: 12.5, netPool: 4987.5, highValue: true });
    expect(prev.body.createCampaignArgs.metadataURI).toBe(`clippo://campaign/${c.id}`);
    const noTx = await call(POST, jsonReq(`/api/campaigns/${c.id}/fund`, CAMPAIGNER, { onchainId: "42" }), c.id);
    expect(noTx.status).toBe(400); // txHash is mandatory; a client-claimed onchainId is ignored
    const saved = process.env.ESCROW_ADDRESS;
    delete process.env.ESCROW_ADDRESS;
    const off = await call(POST, jsonReq(`/api/campaigns/${c.id}/fund`, CAMPAIGNER, { txHash: "0x" + "11".repeat(32) }), c.id);
    process.env.ESCROW_ADDRESS = saved;
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe("NOT_CONFIGURED");
    expect(off.body.error.message).toMatch(/not configured: set ESCROW_ADDRESS/);
  });
});

describe("launch gate on the chain path", () => {
  const deps = { reader: { getCampaign: async () => ({ campaignerFeeBps: 25, creatorFeeBps: 25, highValue: false }) } as never, blockTime: async () => new Date() };

  it("an on-chain approve cannot bypass an unapproved AI-generated source: campaign stays FUNDED, flagged for admin review", async () => {
    const { processLog } = await import("@/lib/chain/indexer");
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const c = await newCampaign(campaigner.id, { status: "FUNDED", contentSource: "AI_GENERATED", payoutMode: "PER_VIEW", approver: null, onchainId: "777" });
    const out = await processLog({ eventName: "CampaignApproved", args: { campaignId: 777n }, transactionHash: "0x" + "77".repeat(32), logIndex: 0, blockNumber: 9n }, deps);
    expect(out.applied).toBe(false);
    expect(out.reason).toMatch(/launch gate/);
    const after = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("FUNDED");
    expect(after.adminReviewReason).toMatch(/AI-generated/);
    const admin = await db.user.findUniqueOrThrow({ where: { wallet: ADMIN } });
    expect(await db.notification.count({ where: { userId: admin.id, type: "LAUNCH_GATE" } })).toBeGreaterThan(0);
  });

  it("a non-AI campaign is approved by the on-chain event as before", async () => {
    const { processLog } = await import("@/lib/chain/indexer");
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const c = await newCampaign(campaigner.id, { status: "FUNDED", payoutMode: "PER_VIEW", approver: null, onchainId: "778" });
    const out = await processLog({ eventName: "CampaignApproved", args: { campaignId: 778n }, transactionHash: "0x" + "78".repeat(32), logIndex: 0, blockNumber: 9n }, deps);
    expect(out.applied).toBe(true);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("APPROVED");
  });
});

describe("anti-fraud: deleted clip", () => {
  it("freezes unclaimed balance, refuses the claim, and unfreezes when dismissed", async () => {
    const { markClipDeleted, resolveFlag } = await import("@/lib/antifraud/flags");
    const claim = await import("@/app/api/payouts/[id]/claim/route");
    const creator = await db.user.findUniqueOrThrow({ where: { wallet: CREATOR } });
    const admin = await db.user.findUniqueOrThrow({ where: { wallet: ADMIN } });
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const channel = await db.channel.findFirstOrThrow({ where: { userId: creator.id } });
    const c = await newCampaign(campaigner.id, { payoutMode: "PER_VIEW", approver: null });
    const sub = await approvedClip(c.id, creator.id, channel.id, "deleted-clip");
    const payout = await db.payout.create({ data: { campaignId: c.id, creatorId: creator.id, amount: 20 } });

    await markClipDeleted(sub, "2026-02-01");
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).clipStatus).toBe("DELETED");
    expect((await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).frozen).toBe(true);
    const flag = await db.fraudFlag.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(flag).toMatchObject({ kind: "CLIP_DELETED", status: "OPEN" });

    const blocked = await call(claim.POST, jsonReq(`/api/payouts/${payout.id}/claim`, CREATOR, {}), payout.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("PAYOUT_FROZEN");

    await resolveFlag(flag.id, "DISMISS", admin.id);
    expect((await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).frozen).toBe(false);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).clipStatus).toBe("LIVE");
    // unfrozen, but a claim is only recorded from a verified on-chain Claimed event: no txHash -> 400
    const noTx = await call(claim.POST, jsonReq(`/api/payouts/${payout.id}/claim`, CREATOR, {}), payout.id);
    expect(noTx.status).toBe(400);
  });

  it("a confirmed deletion keeps the balance frozen", async () => {
    const { markClipDeleted, resolveFlag } = await import("@/lib/antifraud/flags");
    const creator = await db.user.findUniqueOrThrow({ where: { wallet: CREATOR } });
    const admin = await db.user.findUniqueOrThrow({ where: { wallet: ADMIN } });
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const channel = await db.channel.findFirstOrThrow({ where: { userId: creator.id } });
    const c = await newCampaign(campaigner.id, { payoutMode: "PER_VIEW", approver: null });
    const sub = await approvedClip(c.id, creator.id, channel.id, "deleted-two");
    const payout = await db.payout.create({ data: { campaignId: c.id, creatorId: creator.id, amount: 5 } });
    await markClipDeleted(sub, "2026-02-02");
    const flag = await db.fraudFlag.findFirstOrThrow({ where: { submissionId: sub.id } });
    await resolveFlag(flag.id, "CONFIRM", admin.id);
    expect((await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).frozen).toBe(true);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).clipStatus).toBe("DELETED");
  });
});

describe("anti-fraud: view growth feed hold", () => {
  it("excludes snapshots from the day an anomaly was flagged until dismissed", async () => {
    const { latestPerSubmission } = await import("@/lib/snapshots");
    const creator = await db.user.findUniqueOrThrow({ where: { wallet: CREATOR } });
    const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
    const channel = await db.channel.findFirstOrThrow({ where: { userId: creator.id } });
    const c = await newCampaign(campaigner.id, { payoutMode: "PER_VIEW", approver: null });
    const sub = await approvedClip(c.id, creator.id, channel.id, "spiky");
    for (const [day, v] of [["2026-03-01", 1000], ["2026-03-02", 1200], ["2026-03-03", 900000]] as const) {
      await db.viewSnapshot.create({ data: { campaignId: c.id, submissionId: sub.id, creatorId: creator.id, day, cumulativeViews: v } });
    }
    const latest = async () => (await latestPerSubmission()).find((r) => r.submissionId === sub.id)?.cumulativeViews;
    expect(await latest()).toBe(900000);
    const flag = await db.fraudFlag.create({ data: { kind: "VIEW_ANOMALY", campaignId: c.id, submissionId: sub.id, day: "2026-03-03", details: {} } });
    expect(await latest()).toBe(1200);
    await db.fraudFlag.update({ where: { id: flag.id }, data: { status: "DISMISSED" } });
    expect(await latest()).toBe(900000);
  });
});
