import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { notifyAdmins } from "@/lib/notify";
import { assertVerifiedHuman } from "@/lib/worldid/signup";
import { getPlatform } from "@/lib/platforms";

/** Check the verification code is present in the channel bio; marks the channel verified. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CREATOR"]);
  assertVerifiedHuman(user, "channel proof");
  const ch = await db.channel.findUnique({ where: { id: (await params).id } });
  if (!ch || ch.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Channel not found");
  if (ch.verified) return ok({ channel: ch });
  const r = await getPlatform(ch.platform).client().checkChannelCode(ch.handle, ch.verificationCode);
  if (!r.ok && r.unavailable) {
    // PRD 4.7: cannot be read automatically -> human review (admin confirms via POST /api/channels/:id/review).
    await notifyAdmins({
      type: "CHANNEL_REVIEW",
      title: `${ch.platform} channel needs manual review`,
      body: `@${ch.handle} (code ${ch.verificationCode}): ${r.reason ?? "could not be read automatically"}`,
      refType: "channel",
      refId: ch.id,
    });
    return ok({ channel: ch, review: true, reason: r.reason }, 202);
  }
  if (!r.ok) throw new ApiError(422, "CODE_NOT_FOUND", r.reason ?? "Verification code not found in channel bio");
  const channel = await db.channel.update({ where: { id: ch.id }, data: { verified: true, externalId: r.externalId } });
  return ok({ channel });
});
