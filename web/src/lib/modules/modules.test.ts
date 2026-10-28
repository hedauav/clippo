import { afterEach, describe, expect, it } from "vitest";
import { isEnabled, requireFeature } from "../features";
import { computeTier, countFraudFlags, type LadderMetrics } from "./ladder";
import { computeCredit, referralConfig } from "./referral";
import { hashPayload, tierToNumber } from "./profile";

const m = (o: Partial<LadderMetrics> = {}): LadderMetrics => ({
  approvedClips: 0,
  reviewedClips: 0,
  approveRate: 0,
  fraudFlags: 0,
  verifiedViews: 0,
  ...o,
});

describe("feature flags", () => {
  afterEach(() => {
    delete process.env.FEATURE_REFERRAL;
  });
  it("is off by default and 404s", () => {
    expect(isEnabled("referral")).toBe(false);
    expect(() => requireFeature("referral")).toThrowError(/not enabled/);
  });
  it("turns on with true/1", () => {
    process.env.FEATURE_REFERRAL = "true";
    expect(isEnabled("referral")).toBe(true);
    process.env.FEATURE_REFERRAL = "1";
    expect(isEnabled("referral")).toBe(true);
  });
});

describe("status ladder", () => {
  it("unverified has no tier", () => expect(computeTier(false, m({ approvedClips: 99 }))).toBeNull());
  it("verified baseline", () => expect(computeTier(true, m())).toBe("VERIFIED"));
  it("climbs on clips, reliability and views", () => {
    expect(computeTier(true, m({ approvedClips: 5, approveRate: 0.8, verifiedViews: 2000 }))).toBe("RISING");
    expect(computeTier(true, m({ approvedClips: 20, approveRate: 0.9, verifiedViews: 60000 }))).toBe("PARTNER");
    expect(computeTier(true, m({ approvedClips: 60, approveRate: 0.95, verifiedViews: 900000 }))).toBe("TOP");
  });
  it("low approve rate blocks promotion", () => {
    expect(computeTier(true, m({ approvedClips: 60, approveRate: 0.5, verifiedViews: 900000 }))).toBe("VERIFIED");
  });
  it("fraud flags cap at VERIFIED", () => {
    expect(computeTier(true, m({ approvedClips: 60, approveRate: 0.99, verifiedViews: 9e6, fraudFlags: 1 }))).toBe("VERIFIED");
  });
  it("counts only fraud flags", () => {
    expect(countFraudFlags(["duplicate", "unreadable", "Injection"])).toBe(2);
    expect(countFraudFlags(null)).toBe(0);
  });
});

describe("referral fraud limits", () => {
  const cfg = { cutBps: 500, capUsdc: 100, cooldownMs: 86_400_000 };
  const now = new Date("2026-01-10T00:00:00Z");
  it("takes the cut", () => {
    expect(computeCredit({ activity: 1000, cfg, credited: 0, lastCreditAt: null, now, frozen: false })).toEqual({ credit: 50, reason: "OK" });
  });
  it("clamps to cap then stops", () => {
    expect(computeCredit({ activity: 10000, cfg, credited: 0, lastCreditAt: null, now, frozen: false }).credit).toBe(100);
    expect(computeCredit({ activity: 10, cfg, credited: 100, lastCreditAt: null, now, frozen: false }).reason).toBe("CAP_REACHED");
  });
  it("enforces cooldown", () => {
    const last = new Date(now.getTime() - 3600_000);
    expect(computeCredit({ activity: 10, cfg, credited: 0, lastCreditAt: last, now, frozen: false }).reason).toBe("COOLDOWN");
  });
  it("frozen earns nothing", () => {
    expect(computeCredit({ activity: 10, cfg, credited: 0, lastCreditAt: null, now, frozen: true }).reason).toBe("FROZEN");
  });
  it("config caps cut at 10%", () => {
    process.env.REFERRAL_CUT_BPS = "5000";
    expect(referralConfig().cutBps).toBe(1000);
    delete process.env.REFERRAL_CUT_BPS;
  });
});

describe("profile payload", () => {
  it("maps tiers to contract numbers", () => {
    expect(tierToNumber(null)).toBe(0);
    expect(tierToNumber("VERIFIED")).toBe(1);
    expect(tierToNumber("TOP")).toBe(4);
  });
  it("hash is deterministic", () => {
    const p = { tier: 1, approvedClips: 1, rejectedClips: 0, totalViews: 5, totalEarnedUsdc: 0 };
    expect(hashPayload(p)).toBe(hashPayload({ ...p }));
    expect(hashPayload(p)).not.toBe(hashPayload({ ...p, totalViews: 6 }));
  });
});
