import { rateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageCampaign, getCampaign, type Ctx } from "@/lib/domain";
import { z } from "zod";
import { ApiError, ok, route } from "@/lib/http";
import { proposalView, proposeSplit } from "@/lib/agentpass/service";

/**
 * The delegated AI agent proposes a split (signed AgentKit payload, verified against AgentBook). This PROPOSES ONLY: no payout and
 * no approval is created. A human then approves via POST /split with `agentProposalId` and a fresh World ID proof.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  await rateLimit(req, "campaigns/[id]/split/propose", 20, 3600);
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const c = await getCampaign((await params).id);
  if (!canManageCampaign(user, c)) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  if (c.payoutMode !== "HUMAN_SPLIT") throw new ApiError(409, "BAD_STATE", "Campaign is not HUMAN_SPLIT");
  if (c.status !== "APPROVED") throw new ApiError(409, "BAD_STATE", `Campaign is ${c.status}, expected APPROVED`);
  // Body is optional. Default is the AI proposer (Claude or Gemini via getLlm(); 503 NOT_CONFIGURED only when neither GEMINI_API_KEY nor ANTHROPIC_API_KEY is set); `mode: "deterministic"` is the explicit non-AI planner.
  const text = await req.text();
  const { mode } = z.object({ mode: z.enum(["llm", "deterministic"]).default("llm") }).parse((() => { try { return text.trim() ? JSON.parse(text) : {}; } catch { throw new ApiError(400, "BAD_JSON", "Request body must be valid JSON"); } })());
  const uri = new URL(`/api/campaigns/${c.id}/split/propose`, req.url).toString();
  const p = await proposeSplit(user, c, uri, mode);
  const agent = await db.agentIdentity.findUnique({ where: { id: p.agentId } });
  return ok({ proposal: proposalView(p, agent ?? undefined) }, 201);
});
