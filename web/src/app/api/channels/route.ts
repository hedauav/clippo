import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { assertVerifiedHuman } from "@/lib/worldid/signup";
import { getPlatform } from "@/lib/platforms";

const body = z.object({ platform: z.enum(["YOUTUBE", "X", "INSTAGRAM"]), handle: z.string().min(2).max(100) });

/** Start channel ownership proof: returns a code the creator must paste in their channel bio. */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  assertVerifiedHuman(user, "channel proof");
  const v = body.parse(await readJson(req));
  const adapter = getPlatform(v.platform);
  const handle = adapter.normalizeHandle(v.handle);
  if (!adapter.isValidHandle(handle)) throw new ApiError(400, "BAD_HANDLE", `Not a valid ${v.platform} handle`);
  const existing = await db.channel.findUnique({ where: { platform_handle: { platform: v.platform, handle } } });
  if (existing && existing.userId !== user.id) throw new ApiError(409, "CHANNEL_TAKEN", "Channel already linked to another account");
  if (existing) return ok({ channel: existing });
  const channel = await db.channel.create({
    data: { userId: user.id, platform: v.platform, handle, verificationCode: `clippo-${randomBytes(4).toString("hex")}` },
  });
  return ok({ channel }, 201);
});

export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  const channels = await db.channel.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return ok({ channels });
});
