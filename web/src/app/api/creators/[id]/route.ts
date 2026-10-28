import { ok, route } from "@/lib/http";
import { getCreatorCard, type IdCtx } from "@/lib/workspace/hires";

export const GET = route(async (_req: Request, { params }: IdCtx) => {
  return ok({ creator: await getCreatorCard((await params).id) });
});
