import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { ok, readJson, route } from "@/lib/http";
import { proofSchema } from "@/lib/domain";
import { getWorldId } from "@/lib/worldid";
import { completeSignup } from "@/lib/worldid/signup";

/** Validate an IDKit proof server-side; on success mark the account verified (one human, one account: 409 ALREADY_USED). */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "worldid/verify", 30, 3600);
  const user = await requireUser(req);
  const proof = proofSchema.parse(await readJson(req));
  const wid = getWorldId();
  const updated = await completeSignup(user, proof, wid);
  return ok({ user: updated, mode: wid.mode });
});
