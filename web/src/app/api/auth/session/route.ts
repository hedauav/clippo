import { z } from "zod";
import { rateLimit } from "@/lib/ratelimit";
import { NextResponse } from "next/server";
import { COOKIE, adminWallets, createToken, normalizeWallet } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, readJson, route, withDb } from "@/lib/http";
import { devAuthAllowed, verifySiwe } from "@/lib/siwe";

const body = z.object({
  /** SIWE (EIP-4361) message + wallet signature. Required in production. */
  message: z.string().min(20).max(4000).optional(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  /** Dev bypass only (NODE_ENV != production): bare wallet without a signature. */
  wallet: z.string().min(4).max(100).optional(),
  role: z.enum(["CAMPAIGNER", "CREATOR"]).optional(),
});

/**
 * Sign in (or sign up). Production: wallet signature over a server nonce (SIWE). Development: `{wallet, role}` without a
 * signature is accepted as a convenience. Returns a signed token and sets the session cookie.
 */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "auth/session", 30, 600);
  const b = body.parse(await readJson(req));
  let wallet: string;
  if (b.message && b.signature) {
    wallet = await withDb(() => verifySiwe(req, b.message!, b.signature!));
  } else if (b.wallet && devAuthAllowed()) {
    wallet = normalizeWallet(b.wallet);
  } else {
    throw new ApiError(
      401,
      "SIGNATURE_REQUIRED",
      "Sign in with a wallet signature: GET /api/auth/nonce, sign the SIWE message, POST {message, signature}",
    );
  }
  const isAdmin = adminWallets().includes(wallet);
  let user = await withDb(() => db.user.findUnique({ where: { wallet } }));
  if (!user) {
    if (!isAdmin && !b.role) throw new ApiError(400, "ROLE_REQUIRED", "role is required for a new account");
    user = await db.user.create({ data: { wallet, role: isAdmin ? "ADMIN" : b.role! } });
  } else if (isAdmin && user.role !== "ADMIN") {
    user = await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  }
  const token = createToken(wallet);
  const res = NextResponse.json({ token, user });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    /* Secure only when the request really is https: a Secure cookie on plain http (npm start on a LAN host) is dropped silently. */
    secure: process.env.NODE_ENV === "production" && (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  return res;
});
