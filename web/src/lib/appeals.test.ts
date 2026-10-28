import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import { appealOwner, assertCanEscalate, assertCanResolve, isOverdue } from "./appeals";

const now = new Date("2026-03-10T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3600_000);
const appeal = (over: Partial<Parameters<typeof assertCanResolve>[1]> = {}) => ({
  stage: "CAMPAIGNER",
  status: "OPEN",
  dueAt: hours(10),
  creatorId: "creator",
  campaignerId: "camp",
  ...over,
});
const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as ApiError).code;
  }
  return null;
};
const camp = { id: "camp", role: "CAMPAIGNER" as const };
const admin = { id: "adm", role: "ADMIN" as const };
const creator = { id: "creator", role: "CREATOR" as const };

describe("appeal ownership", () => {
  it("campaigner owns first, admin after SLA or escalation", () => {
    expect(appealOwner(appeal(), now)).toBe("CAMPAIGNER");
    expect(appealOwner(appeal({ dueAt: hours(-1) }), now)).toBe("ADMIN");
    expect(isOverdue(appeal({ dueAt: hours(-1) }), now)).toBe(true);
    expect(appealOwner(appeal({ stage: "ADMIN" }), now)).toBe("ADMIN");
    expect(appealOwner(appeal({ status: "OVERTURNED" }), now)).toBe("NONE");
  });
  it("only the owner may resolve", () => {
    expect(codeOf(() => assertCanResolve(camp, appeal(), now))).toBeNull();
    expect(codeOf(() => assertCanResolve(admin, appeal(), now))).toBe("CAMPAIGNER_FIRST");
    expect(codeOf(() => assertCanResolve(admin, appeal({ dueAt: hours(-1) }), now))).toBeNull();
    expect(codeOf(() => assertCanResolve(admin, appeal({ stage: "ADMIN" }), now))).toBeNull();
    expect(codeOf(() => assertCanResolve(camp, appeal({ stage: "ADMIN" }), now))).toBe("ESCALATED");
    expect(codeOf(() => assertCanResolve({ id: "other", role: "CAMPAIGNER" }, appeal(), now))).toBe("FORBIDDEN");
    expect(codeOf(() => assertCanResolve(camp, appeal({ status: "UPHELD" }), now))).toBe("BAD_STATE");
  });
  it("creator can escalate only after the campaigner upheld; campaigner while open; never twice", () => {
    expect(codeOf(() => assertCanEscalate(creator, appeal()))).toBe("FORBIDDEN");
    expect(codeOf(() => assertCanEscalate(creator, appeal({ status: "UPHELD" })))).toBeNull();
    expect(codeOf(() => assertCanEscalate(camp, appeal()))).toBeNull();
    expect(codeOf(() => assertCanEscalate(camp, appeal({ status: "UPHELD" })))).toBe("FORBIDDEN");
    expect(codeOf(() => assertCanEscalate(creator, appeal({ status: "UPHELD", stage: "ADMIN" })))).toBe("BAD_STATE");
    expect(codeOf(() => assertCanEscalate(creator, appeal({ status: "OVERTURNED" })))).toBe("FORBIDDEN");
  });
});
