import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { wizardAnswersSchema, writeCampaign } from "@/lib/ai/campaign-writer";
import { getLlm } from "@/lib/ai/llm";
import { ok, readJson, route } from "@/lib/http";

/** Wizard answers -> generated story + suggested pool / rate / view-target options. */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "wizard/suggest", 30, 3600);
  await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const answers = wizardAnswersSchema.parse(await readJson(req));
  const llm = getLlm();
  const result = await writeCampaign(answers, llm);
  return ok({ ...result, aiMode: llm.mode });
});
