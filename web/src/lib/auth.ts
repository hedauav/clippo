import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role, User } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./http";
import { devAuthAllowed } from "./siwe";

/**
 * Session model:
 *  - Production: POST /api/auth/session {message, signature} (SIWE: wallet signature over a server nonce, see siwe.ts).
 *  - Development (NODE_ENV != production only): {wallet, role} without a signature, and the `x-wallet` header.
 *  - Token = base64url(JSON{wallet,exp}) + "." + HMAC-SHA256(SESSION_SECRET), sent as the `clippo_session` HttpOnly
 *    cookie or `Authorization: Bearer <token>`.
 */
export const COOKIE = "clippo_session";
const TTL_MS = 7 * 24 * 3600 * 1000;

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!s || s.length < 32) throw new Error("SESSION_SECRET (>= 32 chars) is required in production");
    return s;
  }
  if (s) return s;
  return "dev-insecure-secret";
};
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function normalizeWallet(w: string): string {
  return w.trim().toLowerCase();
}

export function createToken(wallet: string): string {
  const payload = Buffer.from(JSON.stringify({ wallet, exp: Date.now() + TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { wallet, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof wallet !== "string" || typeof exp !== "number" || exp < Date.now()) return null;
    return wallet;
  } catch {
    return null;
  }
}

export function adminWallets(): string[] {
  return (process.env.ADMIN_WALLETS ?? "")
    .split(",")
    .map((s) => normalizeWallet(s))
    .filter(Boolean);
}

/** The x-wallet dev header is honoured only outside production. */
const walletHeaderAllowed = () => devAuthAllowed();

function walletFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (m) {
    const w = verifyToken(decodeURIComponent(m[1]));
    if (w) return w;
  }
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const w = verifyToken(auth.slice(7));
    if (w) return w;
  }
  const hdr = req.headers.get("x-wallet");
  if (hdr && walletHeaderAllowed()) return normalizeWallet(hdr);
  return null;
}

export async function getUser(req: Request): Promise<User | null> {
  const wallet = walletFromRequest(req);
  if (!wallet) return null;
  return db.user.findUnique({ where: { wallet: normalizeWallet(wallet) } });
}

export async function requireUser(req: Request, roles?: Role[]): Promise<User> {
  const user = await getUser(req);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in: GET /api/auth/nonce, then POST /api/auth/session with a SIWE signature");
  if (roles && !roles.includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", `Requires role: ${roles.join(" or ")}`);
  }
  return user;
}
