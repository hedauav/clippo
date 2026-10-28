/**
 * Agent Pass (World AgentKit) integration tests against the throwaway test Postgres.
 * The AI agent proposes (signed AgentKit payload, AgentBook-verified); only humans with a fresh World ID proof approve.
 * Every failure path must leave the action undone AND leave an audit record. AgentBook and World ID are injected doubles.
 */
import { generatePrivateKey } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setOverride } from "@/lib/config";
import type { LlmClient } from "@/lib/ai/llm";
import { clearDoubles, installChainDouble, installDoubles } from "@/test/doubles";
import { resetDb } from "@/test/db";

process.env.ADMIN_WALLETS = "0xad00000000000000000000000000000000000001";
process.env.SESSION_SECRET = "test-secret";
process.env.AGENT_PASS_PRIVATE_KEY = generatePrivateKey();

type Db = typeof import("@/lib/db").db;
let db: Db;

const ADMIN = "0xad00000000000000000000000000000000000001";
const CAMPAIGNER = "0xca00000000000000000000000000000000000002";
const OTHER = "0xca00000000000000000000000000000000000009";
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

type Handler = (req: Request, c: ReturnType<typeof ctx>) => Promise<Response>;
async function call(handler: Handler, req: Request, id: string) {
  const res = await handler(req, ctx(id));
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

let registered = true;
async function setup(over: Record<string, unknown> = {}) {
  const campaigner = await db.user.findUniqueOrThrow({ where: { wallet: CAMPAIGNER } });
  const creator = await db.user.findUniqueOrThrow({ where: { wallet: CREATOR } });
  const channel = await db.channel.findFirstOrThrow({ where: { userId: creator.id } });
  const c = await db.campaign.create({
    data: { campaignerId: campaigner.id, title: "t", story: {}, contentSource: "LINK", platforms: ["YOUTUBE"], payoutMode: "HUMAN_SPLIT", approver: "CAMPAIGNER_AND_ADMIN", poolSize: 500, status: "APPROVED", onchainId: "1", ...over } as never,
  });
  const vid = `v-${Math.random().toString(36).slice(2)}`;
  await db.submission.create({
    data: { campaignId: c.id, creatorId: creator.id, channelId: channel.id, link: `https://youtu.be/${vid}`, videoId: vid, metadata: {}, verdict: { create: { result: "APPROVE", confidence: 0.9, reason: "ok" } } },
  });
  return c;
}

async function propose(campaignId: string, body: Record<string, unknown> = { mode: "deterministic" }) {
  const agentRoute = await import("@/app/api/campaigns/[id]/agent/route");
  const proposeRoute = await import("@/app/api/campaigns/[id]/split/propose/route");
  const d = await call(agentRoute.POST, jsonReq(`/api/campaigns/${campaignId}/agent`, CAMPAIGNER, {}), campaignId);
  expect(d.status).toBe(201);
  const p = await call(proposeRoute.POST, jsonReq(`/api/campaigns/${campaignId}/split/propose`, CAMPAIGNER, body), campaignId);
  expect(p.status).toBe(201);
  return p.body.proposal as { id: string; splitHash: string; splits: { creatorWallet: string; amount: number }[]; agent: { address: string } };
}
const approveBody = (p: { id: string; splits: { creatorWallet: string; amount: number }[] }, worldIdProof: unknown) => ({
  splits: p.splits.map((s) => ({ creatorWallet: s.creatorWallet, amount: s.amount })),
  worldIdProof,
  agentProposalId: p.id,
});
const audits = (campaignId: string) => db.agentAudit.findMany({ where: { campaignId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  installDoubles();
  installChainDouble({ getCampaign: async () => ({ state: 2, campaignerFeeBps: 25, creatorFeeBps: 25, highValue: false }) as never });
  setOverride("agentBook", { lookupHuman: async () => (registered ? "0xhuman-anon-id-0001" : null) });
  db = (await import("@/lib/db")).db;
  await resetDb(db);
  await Promise.all([
    db.user.create({ data: { wallet: ADMIN, role: "ADMIN" } }),
    db.user.create({ data: { wallet: CAMPAIGNER, role: "CAMPAIGNER" } }),
    db.user.create({ data: { wallet: OTHER, role: "CAMPAIGNER" } }),
  ]);
  const creator = await db.user.create({ data: { wallet: CREATOR, role: "CREATOR", verified: true } });
  await db.channel.create({ data: { userId: creator.id, platform: "YOUTUBE", handle: "c", verificationCode: "x", verified: true } });
}, 120_000);

afterAll(async () => {
  clearDoubles();
  setOverride("agentBook", null);
  await db?.$disconnect();
});

describe("agent identity (AgentBook)", () => {
  it("refuses to delegate an agent wallet that no human has registered, and logs it", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/agent/route");
    const c = await setup();
    registered = false;
    const r = await call(POST, jsonReq(`/api/campaigns/${c.id}/agent`, CAMPAIGNER, {}), c.id);
    registered = true;
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("AGENT_NOT_REGISTERED");
    expect(r.body.error.message).toContain("agentkit-cli register");
    expect(await db.agentIdentity.count({ where: { campaignId: c.id } })).toBe(0);
    expect((await audits(c.id))[0]).toMatchObject({ event: "REFUSED", outcome: "AGENT_UNVERIFIED" });
  });

  it("only the campaign owner can delegate; the agent cannot propose before delegation", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/agent/route");
    const prop = await import("@/app/api/campaigns/[id]/split/propose/route");
    const c = await setup();
    expect((await call(POST, jsonReq(`/api/campaigns/${c.id}/agent`, OTHER, {}), c.id)).status).toBe(403);
    const early = await call(prop.POST, jsonReq(`/api/campaigns/${c.id}/split/propose`, CAMPAIGNER, {}), c.id);
    expect(early.body.error.code).toBe("AGENT_NOT_DELEGATED");
  });
});

describe("agent proposal", () => {
  it("is signed by the agent, verified, stored, audited, and moves no money", async () => {
    const c = await setup();
    const p = await propose(c.id);
    expect(p.splits).toMatchObject([{ creatorWallet: CREATOR, amount: 500, units: "500000000" }]);
    const row = await db.agentProposal.findUniqueOrThrow({ where: { id: p.id } });
    const payload = row.payload as { address: string; signature: string; requestId: string };
    expect(payload.address.toLowerCase()).toBe(p.agent.address);
    expect(payload.requestId).toBe(p.splitHash);
    expect(await db.splitProposal.count({ where: { campaignId: c.id } })).toBe(0);
    expect(await db.payout.count({ where: { campaignId: c.id } })).toBe(0);
    expect(await db.humanAttestation.count({ where: { campaignId: c.id } })).toBe(0);
    expect((await audits(c.id)).map((a) => [a.event, a.outcome])).toContainEqual(["PROPOSED", "OK"]);
  });

  it("rejects a tampered or replayed agent payload", async () => {
    const { verifyAgentPayload } = await import("@/lib/agentpass/service");
    const c = await setup();
    const p = await propose(c.id);
    const row = await db.agentProposal.findUniqueOrThrow({ where: { id: p.id } });
    const payload = row.payload as Record<string, unknown>;
    const uri = payload.uri as string;
    // replay: the nonce is already stored
    await expect(verifyAgentPayload(payload, uri, p.splitHash)).rejects.toMatchObject({ code: "AGENT_PAYLOAD_INVALID" });
    // not bound to this split
    await expect(verifyAgentPayload({ ...payload, nonce: "fresh-nonce-1" }, uri, "0x" + "11".repeat(32))).rejects.toMatchObject({ code: "AGENT_PAYLOAD_INVALID" });
    // changed field -> signature no longer matches
    await expect(verifyAgentPayload({ ...payload, nonce: "fresh-nonce-2", statement: "send it all" }, uri, p.splitHash)).rejects.toMatchObject({ code: "AGENT_PAYLOAD_INVALID" });
  });
});

describe("human approval of the agent's proposal: failure paths leave it undone and are logged", () => {
  it("cancelled, expired and replayed proofs; wrong approver; changed split; expired proposal; then success; then already released", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/split/route");
    const c = await setup({ approver: "CAMPAIGNER_ONLY" });
    const p = await propose(c.id);
    const url = `/api/campaigns/${c.id}/split`;
    const undone = async () => {
      expect(await db.splitProposal.count({ where: { campaignId: c.id } })).toBe(0);
      expect(await db.payout.count({ where: { campaignId: c.id } })).toBe(0);
      expect(await db.humanAttestation.count({ where: { campaignId: c.id } })).toBe(0);
      expect((await db.agentProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PROPOSED");
    };

    // cancelled / expired proofs
    for (const bad of ["cancelled", "expired"]) {
      const r = await call(POST, jsonReq(url, CAMPAIGNER, approveBody(p, proof(bad))), c.id);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("WORLD_ID_DENIED");
      await undone();
    }
    // replayed proof
    const used = proof();
    const { proofHashOf } = await import("@/lib/worldid/fresh");
    await db.usedProof.create({ data: { proofHash: proofHashOf(used), userId: "x", action: "clippo-approve-split" } });
    const rep = await call(POST, jsonReq(url, CAMPAIGNER, approveBody(p, used)), c.id);
    expect(rep.body.error.code).toBe("PROOF_REUSED");
    await undone();

    // wrong approver: single-approver campaign, an admin cannot stand in
    const wrong = await call(POST, jsonReq(url, ADMIN, approveBody(p, proof())), c.id);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("WRONG_APPROVER");
    // a different campaigner who does not own it
    const stranger = await call(POST, jsonReq(url, OTHER, approveBody(p, proof())), c.id);
    expect(stranger.status).toBe(403);
    await undone();

    // split changed after the agent proposed it (hash mismatch)
    const changed = await call(POST, jsonReq(url, CAMPAIGNER, { ...approveBody(p, proof()), splits: [{ creatorWallet: CREATOR, amount: 499 }] }), c.id);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("SPLIT_CHANGED");
    await undone();

    // expired proposal
    await db.agentProposal.update({ where: { id: p.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const exp = await call(POST, jsonReq(url, CAMPAIGNER, approveBody(p, proof())), c.id);
    expect(exp.status).toBe(410);
    expect(exp.body.error.code).toBe("PROPOSAL_EXPIRED");
    expect(await db.splitProposal.count({ where: { campaignId: c.id } })).toBe(0);
    expect((await db.agentProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("EXPIRED");

    // fresh proposal, human approves with a fresh proof: only now does anything move
    const p2 = await propose(c.id);
    const good = await call(POST, jsonReq(url, CAMPAIGNER, approveBody(p2, proof())), c.id);
    expect(good.status).toBe(201);
    expect(good.body.proposal.status).toBe("AWAITING_CHAIN");
    expect(good.body.payouts).toEqual([]);
    expect(good.body.onchain.functionName).toBe("approveSplit");
    expect((await db.agentProposal.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe("APPROVED");

    // already released
    const again = await call(POST, jsonReq(url, CAMPAIGNER, approveBody(p2, proof())), c.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_RELEASED");

    // every step is in the audit log, in the right shape
    const log = await audits(c.id);
    const outcomes = log.filter((a) => a.event === "REFUSED").map((a) => a.outcome);
    expect(outcomes).toEqual(expect.arrayContaining(["CANCELLED", "EXPIRED_PROOF", "REPLAYED", "WRONG_APPROVER", "SPLIT_CHANGED", "PROPOSAL_EXPIRED", "ALREADY_RELEASED"]));
    expect(log.filter((a) => a.outcome === "WRONG_APPROVER")).toHaveLength(2);
    expect(log.find((a) => a.event === "APPROVED")).toMatchObject({ outcome: "OK", proofStatus: "VALID", actorRole: "CAMPAIGNER" });
    expect(log.find((a) => a.outcome === "CANCELLED")).toMatchObject({ proofStatus: "CANCELLED" });
    expect(log.find((a) => a.outcome === "REPLAYED")).toMatchObject({ proofStatus: "REPLAYED" });
  });

  it("two-party: the admin must give their own fresh proof on the identical agent proposal", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/split/route");
    const c = await setup();
    const p = await propose(c.id);
    const url = `/api/campaigns/${c.id}/split`;
    const first = proof();
    const a = await call(POST, jsonReq(url, CAMPAIGNER, approveBody(p, first)), c.id);
    expect(a.body.proposal).toMatchObject({ status: "PENDING", awaiting: ["admin"] });
    expect((await db.agentProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PROPOSED");
    // the campaigner's proof cannot be reused by the admin
    const replay = await call(POST, jsonReq(url, ADMIN, approveBody(p, first)), c.id);
    expect(replay.body.error.code).toBe("PROOF_REUSED");
    const b = await call(POST, jsonReq(url, ADMIN, approveBody(p, proof())), c.id);
    expect(b.body.proposal.status).toBe("AWAITING_CHAIN");
    expect((await db.agentProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("APPROVED");
  });

  it("a revoked agent's proposal can no longer be approved", async () => {
    const agentRoute = await import("@/app/api/campaigns/[id]/agent/route");
    const { POST } = await import("@/app/api/campaigns/[id]/split/route");
    const c = await setup();
    const p = await propose(c.id);
    expect((await call(agentRoute.DELETE, jsonReq(`/api/campaigns/${c.id}/agent`, CAMPAIGNER, undefined, "DELETE"), c.id)).status).toBe(200);
    const r = await call(POST, jsonReq(`/api/campaigns/${c.id}/split`, CAMPAIGNER, approveBody(p, proof())), c.id);
    expect(r.body.error.code).toBe("AGENT_REVOKED");
    expect(await db.splitProposal.count({ where: { campaignId: c.id } })).toBe(0);
  });
});

describe("activity feed and widget-side failures", () => {
  it("records a cancelled World ID sheet and exposes proposals, approvals and audit to desk and bench", async () => {
    const auditRoute = await import("@/app/api/campaigns/[id]/split/audit/route");
    const agentRoute = await import("@/app/api/campaigns/[id]/agent/route");
    const adminRoute = await import("@/app/api/admin/agent-pass/route");
    const c = await setup();
    const p = await propose(c.id);
    const rec = await call(auditRoute.POST, jsonReq(`/api/campaigns/${c.id}/split/audit`, CAMPAIGNER, { kind: "CANCELLED", proposalId: p.id, splitHash: p.splitHash }), c.id);
    expect(rec.status).toBe(201);
    const desk = await call(agentRoute.GET, jsonReq(`/api/campaigns/${c.id}/agent`, CAMPAIGNER, undefined, "GET"), c.id);
    expect(desk.body.agents[0]).toMatchObject({ status: "ACTIVE" });
    expect(desk.body.proposals[0]).toMatchObject({ id: p.id, status: "PROPOSED" });
    expect(desk.body.audit.map((a: { outcome: string; source: string }) => `${a.outcome}/${a.source}`)).toContain("CANCELLED/client");
    const bench = await adminRoute.GET(jsonReq("/api/admin/agent-pass", ADMIN, undefined, "GET"));
    const j = (await bench.json()) as { proposals: { id: string }[]; audit: { outcome: string }[] };
    expect(j.proposals.map((x) => x.id)).toContain(p.id);
    expect(j.audit.some((a) => a.outcome === "CANCELLED")).toBe(true);
    // non-admins cannot read the bench feed
    expect((await adminRoute.GET(jsonReq("/api/admin/agent-pass", CAMPAIGNER, undefined, "GET"))).status).toBe(403);
  });
});

describe("Claude-backed proposal (LLM double; model output is untrusted)", () => {
  const llmSays = (answer: string | (() => never)): LlmClient => ({ mode: "test", complete: async () => (typeof answer === "string" ? answer : answer()) });
  const good = (creator: string, amountMicroUsdc: number) => JSON.stringify({ splits: [{ creator, amountMicroUsdc, reason: "Strong, disclosed clip." }], rationale: "One creator.", confidence: 0.9, flags: [] });
  const restore = () => setOverride("llm", null);

  it("stores the model's reasons, rationale and confidence with the signed proposal, and writes no payout or approval", async () => {
    const c = await setup();
    setOverride("llm", llmSays(good(CREATOR, 400_000_000)));
    const p = (await propose(c.id, {})) as unknown as { splits: { amount: number; reason: string }[]; rationale: string; source: string; confidence: number };
    restore();
    expect(p.source).toBe("llm");
    expect(p.splits).toMatchObject([{ amount: 400, reason: "Strong, disclosed clip." }]);
    expect(p.rationale).toBe("One creator.");
    expect(p.confidence).toBe(0.9);
    const row = await db.agentProposal.findFirstOrThrow({ where: { campaignId: c.id } });
    expect((row.payload as { signature: string }).signature).toMatch(/^0x/);
    expect(await db.payout.count({ where: { campaignId: c.id } })).toBe(0);
    expect(await db.splitProposal.count({ where: { campaignId: c.id } })).toBe(0);
  });

  it("an over-pool answer is not used: the deterministic split is proposed and the violation is audited", async () => {
    const c = await setup();
    setOverride("llm", llmSays(good(CREATOR, 900_000_000)));
    const p = (await propose(c.id, {})) as unknown as { source: string; fallback: { code: string }; splits: { amount: number }[] };
    restore();
    expect(p.source).toBe("deterministic");
    expect(p.fallback.code).toBe("CONSTRAINT_VIOLATION");
    expect(p.splits[0]!.amount).toBe(500);
    const a = (await audits(c.id)).find((x) => x.outcome === "AI_REJECTED");
    expect(a).toMatchObject({ event: "REFUSED", code: "CONSTRAINT_VIOLATION" });
    expect(a!.detail).toContain("exceeds the net pool");
  });

  it("a model error falls back and is audited", async () => {
    const c = await setup();
    setOverride("llm", llmSays(() => { throw new Error("boom"); }));
    const p = (await propose(c.id, {})) as unknown as { source: string; fallback: { code: string } };
    restore();
    expect(p).toMatchObject({ source: "deterministic", fallback: { code: "LLM_ERROR" } });
    expect((await audits(c.id)).some((x) => x.code === "LLM_ERROR")).toBe(true);
  });

  it("503 NOT_CONFIGURED without ANTHROPIC_API_KEY (no mock fallback), while mode deterministic still works", async () => {
    const c = await setup();
    const agentRoute = await import("@/app/api/campaigns/[id]/agent/route");
    const proposeRoute = await import("@/app/api/campaigns/[id]/split/propose/route");
    expect((await call(agentRoute.POST, jsonReq(`/api/campaigns/${c.id}/agent`, CAMPAIGNER, {}), c.id)).status).toBe(201);
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    setOverride("llm", null);
    try {
      const r = await call(proposeRoute.POST, jsonReq(`/api/campaigns/${c.id}/split/propose`, CAMPAIGNER, {}), c.id);
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("NOT_CONFIGURED");
      expect(r.body.error.message).toContain("ANTHROPIC_API_KEY");
      expect(await db.agentProposal.count({ where: { campaignId: c.id } })).toBe(0);
      const d = await call(proposeRoute.POST, jsonReq(`/api/campaigns/${c.id}/split/propose`, CAMPAIGNER, { mode: "deterministic" }), c.id);
      expect(d.status).toBe(201);
      expect(d.body.proposal.source).toBe("deterministic");
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
      installDoubles();
    }
  });
});
