import { connection } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, ApiError } from "@/lib/http";
import { exchangeInstagramCode, normalizeInstagramHandle, readOAuthState, storeInstagramToken } from "@/lib/platforms/instagram";

/**
 * OAuth redirect target. Verifies the signed state, exchanges the code, requires the authorised Instagram username to
 * equal the channel handle (ownership proof), stores the encrypted long-lived token and marks the channel verified.
 * Redirects to ?return= (INSTAGRAM_POST_CONNECT_URL, default /) with ?instagram=connected|error.
 */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const back = (status: string, msg?: string) => {
    const to = new URL(process.env.INSTAGRAM_POST_CONNECT_URL || "/", url.origin);
    to.searchParams.set("instagram", status);
    if (msg) to.searchParams.set("message", msg);
    return NextResponse.redirect(to);
  };
  try {
    if (url.searchParams.get("error")) return back("error", url.searchParams.get("error_description") ?? "Authorization denied");
    const st = readOAuthState(url.searchParams.get("state") ?? "");
    const code = url.searchParams.get("code");
    if (!st || !code) throw new ApiError(400, "BAD_STATE", "Invalid or expired OAuth state");
    const ch = await db.channel.findUnique({ where: { id: st.channelId } });
    if (!ch || ch.userId !== st.userId) throw new ApiError(404, "NOT_FOUND", "Channel not found");
    const t = await exchangeInstagramCode(code);
    if (normalizeInstagramHandle(t.username) !== normalizeInstagramHandle(ch.handle)) {
      return back("error", `Authorised account @${t.username} does not match @${ch.handle}`);
    }
    await storeInstagramToken(ch.id, t.token, t.expiresAt);
    await db.channel.update({ where: { id: ch.id }, data: { verified: true, externalId: t.igUserId } });
    return back("connected");
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) return errorResponse(e);
    return back("error", e instanceof Error ? e.message : "OAuth failed");
  }
}
