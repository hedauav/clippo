import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { db } from "@/lib/db";
import { canManageCampaign, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { recordAudit } from "@/lib/agentpass/audit";
import { campaignActivity, delegateAgent } from "@/lib/agentpass/service";

/** Agent Pass activity for one campaign: the delegated agent, what it proposed, who approved with which proof status, and every refusal. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const c = await getCampaign((await params).id);
  if (!canManageCampaign(user, c)) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  return ok(await campaignActivity(c.id));
});

/**
 * The campaigner delegates the AI split proposer (an AgentKit agent wallet) to this HUMAN_SPLIT campaign.
 * Refused (403 AGENT_NOT_REGISTERED) unless AgentBook resolves the agent wallet to a verified human. Idempotent.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  await rateLimit(req, "campaigns/[id]/agent", 30, 3600);
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  if (c.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Only the campaign owner can delegate the agent");
  if (c.payoutMode !== "HUMAN_SPLIT") throw new ApiError(409, "BAD_STATE", "Campaign is not HUMAN_SPLIT");
  const agent = await delegateAgent(user, c);
  return ok({ agent: { id: agent.id, address: agent.address, mode: agent.mode, status: agent.status } }, 201);
});

/** The campaigner revokes the agent: it can no longer propose, and proposals it made can still be refused by approvers. */
export const DELETE = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  if (c.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Only the campaign owner can revoke the agent");
  const r = await db.agentIdentity.updateMany({ where: { campaignId: c.id, status: "ACTIVE" }, data: { status: "REVOKED" } });
  await db.agentProposal.updateMany({ where: { campaignId: c.id, status: "PROPOSED" }, data: { status: "SUPERSEDED" } });
  await recordAudit({ campaignId: c.id, actorId: user.id, actorRole: "CAMPAIGNER", event: "DELEGATED", outcome: "OK", detail: `Agent delegation revoked (${r.count}).`, proofStatus: "NONE" });
  return ok({ revoked: r.count });
});
