import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, route } from "@/lib/http";
import { partnerAccessToken, verifyTransakJwt } from "@/lib/onramp/transak";

/** Transak webhook: body {data: "<JWT>"}, verified (HS256, Partner Access Token) BEFORE anything is read; bad signature -> 401. */
export const POST = route(async (req: Request) => {
  const raw = (await req.json().catch(() => null)) as { data?: string } | null;
  if (!raw?.data) throw new ApiError(400, "BAD_REQUEST", "Missing data");
  const claims = verifyTransakJwt(raw.data, await partnerAccessToken());
  if (!claims) throw new ApiError(401, "BAD_SIGNATURE", "Webhook signature invalid");
  const w = (claims.webhookData ?? claims) as { id?: string; status?: string; partnerOrderId?: string };
  if (w.partnerOrderId) {
    await db.onrampOrder.updateMany({
      where: { id: w.partnerOrderId },
      data: { status: w.status ?? "UNKNOWN", providerOrderId: w.id ?? null, payload: w as object },
    });
  }
  return NextResponse.json({ received: true });
});
