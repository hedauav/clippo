import { requireUser } from "@/lib/auth";
import { ok, route } from "@/lib/http";
import { creatorDashboard } from "@/lib/workspace/marketplace";

export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  return ok(await creatorDashboard(user.id));
});
