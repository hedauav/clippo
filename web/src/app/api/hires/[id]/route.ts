import { requireUser } from "@/lib/auth";
import { ApiError, ok, route } from "@/lib/http";
import { getHire, hireView, isParticipant, type IdCtx } from "@/lib/workspace/hires";

/** Campaigner owner/admin: full view incl. shareToken. A creator on the hire: same read-only view without the token. */
export const GET = route(async (req: Request, { params }: IdCtx) => {
  const user = await requireUser(req);
  const hire = await getHire((await params).id);
  if (user.role === "ADMIN" || hire.campaignerId === user.id) return ok(await hireView(hire, { includeToken: true }));
  if (user.role === "CREATOR" && (await isParticipant(user.id, hire.id))) {
    return ok(await hireView(hire, { includeToken: false }));
  }
  throw new ApiError(403, "FORBIDDEN", "Not your hire");
});
