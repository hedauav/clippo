import { z } from "zod";
import { rateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { generateAeo } from "@/lib/ai/campaign-writer";
import { getLlm } from "@/lib/ai/llm";
import { storySchema } from "@/lib/domain";
import { ok, readJson, route } from "@/lib/http";

const body = z.object({ story: storySchema });

/**
 * Campaign writer: AEO/GEO-style description + FAQ + schema.org JSON-LD for a story, written to be quoted by AI answer
 * engines. Model-refined when ANTHROPIC_API_KEY is set, deterministic otherwise.
 */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "wizard/aeo", 30, 3600);
  await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const { story } = body.parse(await readJson(req));
  const llm = getLlm();
  const { usedLlm, ...aeo } = await generateAeo(story, llm);
  return ok({ aeo, aiMode: llm.mode, usedLlm });
});
