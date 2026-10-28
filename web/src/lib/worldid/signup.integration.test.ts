/** Sign-up proof of human: unique nullifier, friendly refusals, and the verified gate on creator features. Uses explicit doubles. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearDoubles, installDoubles } from "@/test/doubles";
import { resetDb } from "@/test/db";
import { toOnchainArgs, onchainAction, rpIdToBigInt } from "./onchain";

type Db = typeof import("@/lib/db").db;
let db: Db;
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const req = (url: string, wallet: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", body: body ? JSON.stringify(body) : undefined, headers: { host: "localhost", "x-wallet": wallet, "content-type": "application/json" } });
const proof = (n: string, p = "ok") => ({ nullifier_hash: n, proof: p });

beforeAll(async () => {
  installDoubles();
  db = (await import("@/lib/db")).db;
  await resetDb(db);
  await db.user.create({ data: { wallet: A, role: "CREATOR" } });
  await db.user.create({ data: { wallet: B, role: "CREATOR" } });
});
afterAll(async () => {
  clearDoubles();
  await db?.$disconnect();
});

describe("POST /api/worldid/verify", () => {
  it("denies cancelled / expired proofs and leaves the account unverified", async () => {
    const { POST } = await import("@/app/api/worldid/verify/route");
    for (const p of ["cancelled", "expired", "invalid"]) {
      const r = await POST(req("/api/worldid/verify", A, proof("0xaa", p)));
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("WORLD_ID_DENIED");
    }
    expect((await db.user.findUnique({ where: { wallet: A } }))?.verified).toBe(false);
  });

  it("verifies one human once, and refuses the same human on a second account (409 ALREADY_USED), case-insensitively", async () => {
    const { POST } = await import("@/app/api/worldid/verify/route");
    const ok = await POST(req("/api/worldid/verify", A, proof("0xABC123")));
    expect(ok.status).toBe(200);
    expect((await db.user.findUnique({ where: { wallet: A } }))).toMatchObject({ verified: true, worldIdNullifier: "0xabc123" });
    const again = await POST(req("/api/worldid/verify", A, proof("0xabc123"))); // idempotent for the same account
    expect(again.status).toBe(200);
    const second = await POST(req("/api/worldid/verify", B, proof("0xabc123")));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("ALREADY_USED");
    expect((await db.user.findUnique({ where: { wallet: B } }))).toMatchObject({ verified: false, worldIdNullifier: null });
  });

  it("will not let a verified account swap to a different nullifier (that would free the first human for another account)", async () => {
    const { POST } = await import("@/app/api/worldid/verify/route");
    const r = await POST(req("/api/worldid/verify", A, proof("0xdef456")));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("ACCOUNT_ALREADY_VERIFIED");
    expect((await db.user.findUnique({ where: { wallet: A } }))?.worldIdNullifier).toBe("0xabc123");
  });

  it("the DB itself rejects a duplicate nullifier (race safety)", async () => {
    await expect(db.user.update({ where: { wallet: B }, data: { worldIdNullifier: "0xabc123" } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("verified gate on creator features", () => {
  it("channel proof, submissions and claims need a verified human", async () => {
    const ch = await import("@/app/api/channels/route");
    const sub = await import("@/app/api/submissions/route");
    const claim = await import("@/app/api/payouts/[id]/claim/route");
    const c1 = await ch.POST(req("/api/channels", B, { platform: "YOUTUBE", handle: "@someone" }));
    expect(c1.status).toBe(403);
    expect((await c1.json()).error.code).toBe("NOT_VERIFIED");
    const s1 = await sub.POST(req("/api/submissions", B, { campaignId: "x", channelId: "y", link: "https://youtu.be/abc" }));
    expect((await s1.json()).error.code).toBe("NOT_VERIFIED");
    const u = await db.user.findUniqueOrThrow({ where: { wallet: B } });
    const camp = await db.user.create({ data: { wallet: "0x3333333333333333333333333333333333333333", role: "CAMPAIGNER", verified: true } });
    const c = await db.campaign.create({ data: { campaignerId: camp.id, title: "t", story: {}, contentSource: "LINK", platforms: ["YOUTUBE"], status: "APPROVED", payoutMode: "PER_VIEW", ratePer1k: 1, poolSize: 10 } });
    const p = await db.payout.create({ data: { campaignId: c.id, creatorId: u.id, amount: 1 } });
    const k = await claim.POST(req(`/api/payouts/${p.id}/claim`, B, {}), { params: Promise.resolve({ id: p.id }) });
    expect((await k.json()).error.code).toBe("NOT_VERIFIED");
  });
});

describe("on-chain argument mapping (World ID 4.0 verifier)", () => {
  it("maps an IDKit result to verify() args with the action hash reduced by >> 8", () => {
    const r = { protocol_version: "4.0", nonce: "0x05", responses: [{ identifier: "orb", nullifier: "0x01", signal_hash: "0x02", expires_at_min: 3, issuer_schema_id: 1, proof: ["0x1", "0x2", "0x3", "0x4", "0x5"] }] };
    const a = toOnchainArgs(r, "rp_00ff", "act");
    expect(a[0]).toBe(1n);
    expect(a[1]).toBe(onchainAction("act"));
    expect(a[1] < 2n ** 248n).toBe(true);
    expect(a[2]).toBe(255n);
    expect(a[3]).toBe(5n);
    expect(a[8]).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(rpIdToBigInt("rp_00ff")).toBe(255n);
    expect(() => toOnchainArgs({ protocol_version: "3.0", nonce: "n", responses: [{ identifier: "orb", nullifier: "0x1", proof: "p" }] }, "rp_00ff", "act")).toThrow(/uniqueness/);
  });
});
