import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/features";
import { ApiError, route } from "@/lib/http";

export const REF_COOKIE = "clippo_ref";
const code = z.string().min(1).max(64).regex(/^[\w-]+$/);

async function visit(raw: string | null) {
  requireFeature("referral");
  const c = code.parse(raw);
  const link = await db.referralLink.findUnique({ where: { code: c } });
  if (!link || !link.active) throw new ApiError(404, "NOT_FOUND", "Unknown referral code");
  const campaign = await db.campaign.findUnique({ where: { id: link.campaignId }, select: { id: true, title: true, status: true } });
  const res = NextResponse.json({ valid: true, code: c, campaign: campaign && campaign.status === "APPROVED" ? { id: campaign.id, title: campaign.title } : null });
  // Remembered for the first sign-in; POST /api/referral/attribute then works without a body.
  res.cookies.set(REF_COOKIE, c, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86400 });
  return res;
}

/** First visit with ?ref=CODE: GET /api/referral/visit?code=CODE (public) validates the code and stores it in a 30-day cookie. */
export const GET = route(async (req: Request) => {
  return visit(new URL(req.url).searchParams.get("code"));
});

/** Same as GET, with {code} in the JSON body (for SPAs). */
export const POST = route(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  return visit(body.code ?? null);
});
