import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, readJson, route } from "@/lib/http";
import { addCreatorSchema, assertOpen, assertOwner, getHire, hireView, priceFor, type IdCtx } from "@/lib/workspace/hires";

/** Add a creator at one of THEIR rate-card lines (amount = price x quantity). Re-adding updates the line and resets to PROPOSED. */
export const POST = route(async (req: Request, { params }: IdCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const hire = await getHire((await params).id);
  assertOwner(user, hire);
  assertOpen(hire);
  const v = addCreatorSchema.parse(await readJson(req));
  const amount = await priceFor(v.creatorId, v.rateLabel, v.quantity);
  await db.hireCreator.upsert({
    where: { hireId_creatorId: { hireId: hire.id, creatorId: v.creatorId } },
    create: { hireId: hire.id, creatorId: v.creatorId, rateLabel: v.rateLabel, quantity: v.quantity, amount },
    update: { rateLabel: v.rateLabel, quantity: v.quantity, amount, status: "PROPOSED" },
  });
  return ok(await hireView(hire, { includeToken: true }), 201);
});
