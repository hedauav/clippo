import { z } from "zod";
import { ok, route } from "@/lib/http";
import { listCreators } from "@/lib/workspace/hires";

const q = z.object({
  q: z.string().optional(),
  tier: z.enum(["NEW", "RISING", "PRO", "ELITE"]).optional(),
  niche: z.string().optional(),
  platform: z.enum(["YOUTUBE", "X", "INSTAGRAM"]).optional(),
  maxRate: z.coerce.number().positive().optional(),
  sort: z.enum(["tier", "rate", "clips"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Public vetted creator directory with search/filter. */
export const GET = route(async (req: Request) => {
  const f = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ creators: await listCreators(f) });
});
