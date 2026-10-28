import { z } from "zod";
import { ok, route } from "@/lib/http";
import { leaderboard } from "@/lib/workspace/marketplace";

const q = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["views", "earnings"]).default("views"),
});

export const GET = route(async (req: Request) => {
  const v = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ sort: v.sort, creators: await leaderboard(v) });
});
