import { requireUser } from "@/lib/auth";
import { ok, route } from "@/lib/http";
import { pendingProposals } from "@/lib/proposals";

/** Admin queue: every pending HUMAN_SPLIT proposal (status, approvers so far, who is awaited, split hash). */
export const GET = route(async (req: Request) => {
  await requireUser(req, ["ADMIN"]);
  return ok({ proposals: await pendingProposals() });
});
