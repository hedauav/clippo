import { requireUser } from "@/lib/auth";
import { ok, route } from "@/lib/http";
import { campaignerDashboard } from "@/lib/workspace/marketplace";

export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  return ok(await campaignerDashboard(user.id));
});
