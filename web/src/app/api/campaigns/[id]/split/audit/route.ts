import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { canManageCampaign, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { recordAudit } from "@/lib/agentpass/audit";

const body = z.object({
  /** What happened in the World ID sheet before any proof reached the backend. */
  kind: z.enum(["CANCELLED", "EXPIRED", "FAILED"]),
  proposalId: z.string().optional(),
  splitHash: z.string().optional(),
  message: z.string().max(300).optional(),
});

/**
 * Records a check that ended in the widget (cancelled, expired, failed) so the audit log shows it too. Nothing was sent to the
 * backend for those, so the action is undone by construction; this only writes an audit row (marked source "client").
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const c = await getCampaign((await params).id);
  if (!canManageCampaign(user, c)) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  const v = body.parse(await readJson(req));
  const role = user.id === c.campaignerId ? "CAMPAIGNER" : "ADMIN";
  const outcome = v.kind === "CANCELLED" ? "CANCELLED" : v.kind === "EXPIRED" ? "EXPIRED_PROOF" : "PROOF_INVALID";
  await recordAudit({
    campaignId: c.id,
    proposalId: v.proposalId ?? null,
    actorId: user.id,
    actorRole: role,
    event: "REFUSED",
    outcome,
    code: `CLIENT_${v.kind}`,
    detail: `${v.message ?? `The World ID check ${v.kind.toLowerCase()} before completing.`} Nothing was approved.`,
    splitHash: v.splitHash ?? null,
    proofStatus: v.kind === "CANCELLED" ? "CANCELLED" : v.kind === "EXPIRED" ? "EXPIRED" : "INVALID",
    source: "client",
  });
  return ok({ recorded: true }, 201);
});
