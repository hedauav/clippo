import { z } from "zod";
import { ok, route } from "@/lib/http";
import { trendingCampaigns } from "@/lib/workspace/marketplace";

const q = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const GET = route(async (req: Request) => {
  const v = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ windowDays: v.days, campaigns: await trendingCampaigns(v) });
});
