import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { assertOpen, assertOwner, getHire, hireView, type IdCreatorCtx } from "@/lib/workspace/hires";

const body = z.object({ status: z.enum(["PROPOSED", "APPROVED", "REJECTED"]) });

/** Per-creator approval. Returns the full hire view with the live budget rollup. */
export const PATCH = route(async (req: Request, { params }: IdCreatorCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const { id, creatorId } = await params;
  const hire = await getHire(id);
  assertOwner(user, hire);
  assertOpen(hire);
  const { status } = body.parse(await readJson(req));
  const r = await db.hireCreator.updateMany({ where: { hireId: id, creatorId }, data: { status } });
  if (r.count === 0) throw new ApiError(404, "NOT_FOUND", "Creator is not on this hire");
  return ok(await hireView(hire, { includeToken: true }));
});

export const DELETE = route(async (req: Request, { params }: IdCreatorCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const { id, creatorId } = await params;
  const hire = await getHire(id);
  assertOwner(user, hire);
  assertOpen(hire);
  await db.hireCreator.deleteMany({ where: { hireId: id, creatorId } });
  return ok(await hireView(hire, { includeToken: true }));
});
