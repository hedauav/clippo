import type { Appeal, Role } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./http";
import { notify, notifyAdmins } from "./notify";

/**
 * Appeal process (PRD 4.2: creators can appeal; campaigner reviews first, admin is the escalation).
 *
 *   creator appeals a REJECT      -> Appeal{stage CAMPAIGNER, status OPEN}, campaigner notified
 *   campaigner decides            -> OVERTURNED (final, verdict becomes APPROVE)
 *                                 -> UPHELD (creator may escalate; verdict.appealStatus UPHELD)
 *   creator/campaigner escalates  -> stage ADMIN, status OPEN, admins notified, verdict.appealStatus PENDING
 *   campaigner silent past dueAt  -> admin may take over without escalation (overdue)
 *   admin decides                 -> final UPHELD / OVERTURNED
 * Resolving an appeal only changes the verdict; payouts are never touched here.
 */
export const APPEAL_SLA_HOURS = Number(process.env.APPEAL_SLA_HOURS) || 72;
export const appealDueAt = (from = new Date()) => new Date(from.getTime() + APPEAL_SLA_HOURS * 3600_000);

type A = Pick<Appeal, "stage" | "status" | "dueAt" | "creatorId" | "campaignerId">;

export const isOverdue = (a: Pick<Appeal, "stage" | "status" | "dueAt">, now = new Date()) =>
  a.stage === "CAMPAIGNER" && a.status === "OPEN" && a.dueAt.getTime() < now.getTime();

/** Who currently owns the appeal. */
export const appealOwner = (a: Pick<Appeal, "stage" | "status" | "dueAt">, now = new Date()): "CAMPAIGNER" | "ADMIN" | "NONE" => {
  if (a.status !== "OPEN") return "NONE";
  if (a.stage === "ADMIN" || isOverdue(a, now)) return "ADMIN";
  return "CAMPAIGNER";
};

/** Throws if this user may not resolve the appeal right now. */
export function assertCanResolve(user: { id: string; role: Role }, a: A, now = new Date()): void {
  if (a.status !== "OPEN") throw new ApiError(409, "BAD_STATE", "Appeal is already resolved");
  if (user.role === "ADMIN") {
    if (appealOwner(a, now) !== "ADMIN") {
      throw new ApiError(409, "CAMPAIGNER_FIRST", `The campaigner reviews first; an admin can step in after ${a.dueAt.toISOString()} or once it is escalated`);
    }
    return;
  }
  if (user.id !== a.campaignerId) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  if (a.stage !== "CAMPAIGNER") throw new ApiError(409, "ESCALATED", "This appeal was escalated to an admin");
}

export function assertCanEscalate(user: { id: string; role: Role }, a: A): void {
  if (a.stage !== "CAMPAIGNER") throw new ApiError(409, "BAD_STATE", "Already with an admin");
  const creatorOk = user.id === a.creatorId && a.status === "UPHELD"; // creator only after the campaigner upheld the rejection
  const campaignerOk = user.id === a.campaignerId && a.status === "OPEN"; // campaigner may hand it up instead of deciding
  if (!creatorOk && !campaignerOk) throw new ApiError(403, "FORBIDDEN", "Only the creator (after an upheld rejection) or the campaigner (while open) can escalate");
}

/** Create the appeal record and notify the campaigner. */
export async function openAppeal(input: { submissionId: string; verdictId: string; campaignId: string; creatorId: string; campaignerId: string; note: string; title: string }) {
  const appeal = await db.appeal.create({
    data: {
      submissionId: input.submissionId,
      verdictId: input.verdictId,
      campaignId: input.campaignId,
      creatorId: input.creatorId,
      campaignerId: input.campaignerId,
      note: input.note,
      dueAt: appealDueAt(),
    },
  });
  await notify({
    userId: input.campaignerId,
    type: "APPEAL_OPENED",
    title: "A creator appealed a rejected clip",
    body: `${input.title}: ${input.note.slice(0, 200)}. Please review before ${appeal.dueAt.toISOString()}, after which an admin may take over.`,
    refType: "appeal",
    refId: appeal.id,
  });
  return appeal;
}

/**
 * Called by the verdict endpoint when a human sets a verdict. Returns the new Verdict.appealStatus to store.
 * Handles legacy pending appeals that predate the Appeal table (no record -> old behaviour).
 */
export async function onVerdictSet(
  user: { id: string; role: Role },
  s: { id: string; creatorId: string },
  verdict: { appealStatus: "NONE" | "PENDING" | "UPHELD" | "OVERTURNED" },
  result: "APPROVE" | "REJECT",
  reason: string,
): Promise<"NONE" | "PENDING" | "UPHELD" | "OVERTURNED"> {
  if (verdict.appealStatus !== "PENDING") return verdict.appealStatus;
  const appeal = await db.appeal.findUnique({ where: { submissionId: s.id } });
  const outcome = result === "REJECT" ? "UPHELD" : "OVERTURNED";
  if (!appeal) return outcome;
  assertCanResolve(user, appeal);
  const byAdmin = user.role === "ADMIN";
  await db.appeal.update({
    where: { id: appeal.id },
    data: { status: outcome, resolution: reason, resolvedById: user.id, resolvedAt: new Date(), ...(byAdmin ? { stage: "ADMIN" } : {}) },
  });
  const escalatable = !byAdmin && outcome === "UPHELD";
  await notify({
    userId: s.creatorId,
    type: outcome === "OVERTURNED" ? "APPEAL_OVERTURNED" : "APPEAL_UPHELD",
    title: outcome === "OVERTURNED" ? "Your appeal succeeded" : "Your appeal was not accepted",
    body: `${reason.slice(0, 300)}${escalatable ? " You can escalate this to an admin." : ""}`,
    refType: "appeal",
    refId: appeal.id,
  });
  return outcome;
}

export const appealView = (a: Appeal) => ({ ...a, owner: appealOwner(a), overdue: isOverdue(a) });

export async function escalateAppeal(user: { id: string; role: Role }, appeal: Appeal) {
  assertCanEscalate(user, appeal);
  const [updated] = await db.$transaction([
    db.appeal.update({ where: { id: appeal.id }, data: { stage: "ADMIN", status: "OPEN", escalatedAt: new Date(), escalatedBy: user.id, resolution: null, resolvedAt: null, resolvedById: null } }),
    db.verdict.update({ where: { id: appeal.verdictId }, data: { appealStatus: "PENDING" } }),
  ]);
  await notifyAdmins({ type: "APPEAL_ESCALATED", title: "Appeal escalated to admin", body: `Submission ${appeal.submissionId} needs an admin decision.`, refType: "appeal", refId: appeal.id });
  const other = user.id === appeal.creatorId ? appeal.campaignerId : appeal.creatorId;
  await notify({ userId: other, type: "APPEAL_ESCALATED", title: "Appeal escalated to admin", body: "An admin will make the final decision.", refType: "appeal", refId: appeal.id });
  return updated;
}
