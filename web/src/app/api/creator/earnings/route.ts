import { requireUser } from "@/lib/auth";
import { creatorEarnings } from "@/lib/earnings";
import { ok, route } from "@/lib/http";

export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  return ok(await creatorEarnings(user.id));
});
