import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { ApiError, route } from "@/lib/http";
import { attribute } from "@/lib/modules/referral";

const REF_COOKIE = "clippo_ref";

/**
 * The referred creator redeems a referral code. Referee must be a verified unique human. `code` may be omitted when the
 * visitor arrived through GET /api/referral/visit?code=... (the code is then read from the `clippo_ref` cookie).
 */
export const POST = route(async (req: Request) => {
  requireFeature("referral");
  const user = await requireUser(req, ["CREATOR"]);
  const raw = await req.text();
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "BAD_JSON", "Request body must be valid JSON");
    }
  }
  const body = z.object({ code: z.string().min(1).optional() }).parse(parsed);
  const cookieCode = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${REF_COOKIE}=([^;]+)`))?.[1];
  const code = body.code ?? cookieCode;
  if (!code) throw new ApiError(400, "BAD_REQUEST", "No referral code (send {code} or visit /api/referral/visit?code= first)");
  const attribution = await attribute(user.id, decodeURIComponent(code));
  const res = NextResponse.json({ attribution }, { status: 201 });
  res.cookies.delete(REF_COOKIE);
  return res;
});
