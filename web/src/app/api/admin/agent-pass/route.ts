import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/http";
import { agentPassMode } from "@/lib/agentpass/identity";
import { auditView } from "@/lib/agentpass/audit";
import { proposalView } from "@/lib/agentpass/service";

/** Admin bench: open agent proposals across campaigns plus the latest Agent Pass audit trail (including every refusal). */
export const GET = route(async (req: Request) => {
  await requireUser(req, ["ADMIN"]);
  const [proposals, audit, agents] = await Promise.all([
    db.agentProposal.findMany({ where: { status: "PROPOSED" }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.agentAudit.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    db.agentIdentity.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const campaigns = await db.campaign.findMany({ where: { id: { in: [...new Set([...proposals.map((p) => p.campaignId), ...audit.map((a) => a.campaignId)])] } }, select: { id: true, title: true, approver: true } });
  const title = (id: string) => campaigns.find((c) => c.id === id)?.title ?? id;
  return ok({
    mode: agentPassMode(),
    proposals: proposals.map((p) => ({ ...proposalView(p, agents.find((a) => a.id === p.agentId)), campaignTitle: title(p.campaignId), twoParty: campaigns.find((c) => c.id === p.campaignId)?.approver === "CAMPAIGNER_AND_ADMIN" })),
    audit: audit.map((a) => ({ ...auditView(a), campaignTitle: title(a.campaignId) })),
  });
});
