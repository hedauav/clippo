import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { ok, readJson, route } from "@/lib/http";
import { buildPayload, getProfile, setOptIn } from "@/lib/modules/profile";

export const GET = route(async (req: Request) => {
  requireFeature("tokenization");
  const user = await requireUser(req, ["CREATOR"]);
  return ok({ profile: await getProfile(user.id), preview: await buildPayload(user.id) });
});

/** Opt in or out of the on-chain profile. Opting out clears the synced state (on-chain `optOut` is done by the wallet). */
export const POST = route(async (req: Request) => {
  requireFeature("tokenization");
  const user = await requireUser(req, ["CREATOR"]);
  const { optIn } = z.object({ optIn: z.boolean() }).parse(await readJson(req));
  return ok({ profile: await setOptIn(user.id, optIn) });
});
