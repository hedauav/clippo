import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { resolveFlag } from "@/lib/antifraud/flags";
import { today } from "@/lib/snapshots";

const body = z.object({ held: z.boolean(), reason: z.string().max(500).optional() });

/**
 * Admin places or lifts a hold on a clip flagged for suspicious growth. A hold is a VIEW_ANOMALY fraud flag, which the
 * snapshot feed already honours (views after the flagged day stop being reported). It only ever withholds; it never
 * releases or moves funds.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const admin = await requireUser(req, ["ADMIN"]);
  const id = (await params).id;
  const sub = await db.submission.findUnique({ where: { id }, select: { id: true, campaignId: true } });
  if (!sub) throw new ApiError(404, "NOT_FOUND", "Submission not found");
  const v = body.parse(await readJson(req));
  if (v.held) {
    await db.fraudFlag.upsert({
      where: { submissionId_kind_day: { submissionId: id, kind: "VIEW_ANOMALY", day: today() } },
      create: { kind: "VIEW_ANOMALY", campaignId: sub.campaignId, submissionId: id, day: today(), details: { manual: true, by: admin.id, reason: v.reason ?? null } },
      update: { status: "OPEN", resolvedAt: null, resolvedBy: null },
    });
  } else {
    const open = await db.fraudFlag.findMany({ where: { submissionId: id, kind: "VIEW_ANOMALY", status: "OPEN" } });
    for (const f of open) await resolveFlag(f.id, "DISMISS", admin.id);
  }
  const held = (await db.fraudFlag.count({ where: { submissionId: id, kind: "VIEW_ANOMALY", status: { in: ["OPEN", "CONFIRMED"] } } })) > 0;
  return ok({ held });
});
