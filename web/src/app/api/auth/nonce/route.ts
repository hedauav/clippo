import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { route, withDb } from "@/lib/http";
import { issueNonce } from "@/lib/siwe";

/** Issue a single-use SIWE nonce (10 min). */
export const GET = route(async (req: Request) => {
  await rateLimit(req, "auth/nonce", 60, 600);
  return NextResponse.json(await withDb(() => issueNonce(req)));
});
