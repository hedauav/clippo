import { createHmac, timingSafeEqual } from "node:crypto";
import { getOverride, requireEnv } from "../config";

/** Transak is the fiat -> USDC on-ramp. Staging by default; set TRANSAK_ENV=production to go live. */
export interface TransakClient {
  createWidgetUrl(params: Record<string, string | number>, userIp: string): Promise<string>;
}

const hosts = () =>
  process.env.TRANSAK_ENV === "production"
    ? { gateway: "https://api-gateway.transak.com", partners: "https://api.transak.com" }
    : { gateway: "https://api-gateway-stg.transak.com", partners: "https://api-stg.transak.com" };

export const transakApiKey = () => requireEnv("Transak on-ramp", "TRANSAK_API_KEY");
export const transakSecret = () => requireEnv("Transak on-ramp", "TRANSAK_API_SECRET");

let cached: { token: string; exp: number } | null = null;

/** Partner access token (POST /partners/api/v2/refresh-token, valid 7 days, cached in memory). Also the webhook JWT secret. */
export async function partnerAccessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${hosts().partners}/partners/api/v2/refresh-token`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-secret": transakSecret() },
    body: JSON.stringify({ apiKey: transakApiKey() }),
  });
  if (!res.ok) throw new Error(`Transak refresh-token failed (${res.status})`);
  const j = (await res.json()) as { data?: { accessToken?: string; expiresAt?: number } };
  if (!j.data?.accessToken) throw new Error("Transak returned no access token");
  cached = { token: j.data.accessToken, exp: (j.data.expiresAt ?? Math.floor(Date.now() / 1000) + 6 * 86400) * 1000 };
  return cached.token;
}

export function getTransak(): TransakClient {
  const o = getOverride<TransakClient>("transak");
  if (o) return o;
  return {
    async createWidgetUrl(widgetParams, userIp) {
      const token = await partnerAccessToken();
      const res = await fetch(`${hosts().gateway}/api/v2/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json", "access-token": token, "x-api-key": transakApiKey(), "x-user-ip": userIp },
        body: JSON.stringify({ widgetParams }),
      });
      if (!res.ok) throw new Error(`Transak session failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { data?: { widgetUrl?: string } };
      if (!j.data?.widgetUrl) throw new Error("Transak returned no widgetUrl");
      return j.data.widgetUrl;
    },
  };
}

/**
 * Verifies a Transak webhook: body `{ data: "<JWT>" }` signed HS256 with the Partner Access Token. Returns the claims
 * (the order lives in `webhookData`) or null when the signature/expiry is invalid. Constant-time compare.
 */
export function verifyTransakJwt(jwt: string, secret: string): Record<string, unknown> | null {
  const [h, p, sig] = jwt.split(".");
  if (!h || !p || !sig) return null;
  try {
    if ((JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: string }).alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
    const got = Buffer.from(sig, "base64url");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
