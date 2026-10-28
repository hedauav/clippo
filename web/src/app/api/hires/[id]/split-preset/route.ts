import { requireUser } from "@/lib/auth";
import { ok, route } from "@/lib/http";
import { assertOwner, getHire, presetSplit, type IdCtx } from "@/lib/workspace/hires";

/** Ready-to-send `splits` for POST /api/campaigns/:id/split (add worldIdProof). */
export const GET = route(async (req: Request, { params }: IdCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const hire = await getHire((await params).id);
  assertOwner(user, hire);
  return ok(await presetSplit(hire));
});
