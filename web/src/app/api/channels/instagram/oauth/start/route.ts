import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { instagramAuthorizeUrl, makeOAuthState } from "@/lib/platforms/instagram";

const body = z.object({ channelId: z.string().min(1) });

/** Returns the Instagram OAuth authorize URL for one of the creator's INSTAGRAM channels. 503 NOT_CONFIGURED without INSTAGRAM_APP_ID/SECRET/REDIRECT_URI. */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  const { channelId } = body.parse(await readJson(req));
  const ch = await db.channel.findUnique({ where: { id: channelId } });
  if (!ch || ch.userId !== user.id || ch.platform !== "INSTAGRAM") throw new ApiError(404, "NOT_FOUND", "Instagram channel not found");
  return ok({ url: instagramAuthorizeUrl(makeOAuthState(ch.id, user.id)) });
});
