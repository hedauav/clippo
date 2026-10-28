import { z } from "zod";
import { rateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { getTransak, transakApiKey } from "@/lib/onramp/transak";

const body = z.object({ campaignId: z.string().optional(), amount: z.number().positive().max(1_000_000) });

/**
 * POST /api/onramp/session {campaignId?, amount} -> {url, orderId}. Creates a single-use (5 min) Transak widget URL for buying
 * `amount` USDC to the signed-in wallet. 503 NOT_CONFIGURED without TRANSAK_API_KEY / TRANSAK_API_SECRET.
 */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "onramp/session", 20, 3600);
  const user = await requireUser(req);
  const v = body.parse(await readJson(req));
  const apiKey = transakApiKey();
  const referrerDomain = process.env.TRANSAK_REFERRER_DOMAIN || new URL(req.url).host;
  const order = await db.onrampOrder.create({ data: { userId: user.id, campaignId: v.campaignId ?? null, amount: v.amount } });
  const params: Record<string, string | number> = {
    apiKey,
    referrerDomain,
    productsAvailable: "BUY",
    cryptoCurrencyCode: "USDC",
    fiatCurrency: "USD",
    fiatAmount: v.amount,
    walletAddress: user.wallet,
    disableWalletAddressForm: "true",
    partnerOrderId: order.id,
    partnerCustomerId: user.id,
    ...(process.env.TRANSAK_NETWORK ? { network: process.env.TRANSAK_NETWORK } : {}),
    ...(process.env.TRANSAK_REDIRECT_URL ? { redirectURL: process.env.TRANSAK_REDIRECT_URL } : {}),
  };
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";
  try {
    const url = await getTransak().createWidgetUrl(params, ip);
    return ok({ url, orderId: order.id, environment: process.env.TRANSAK_ENV === "production" ? "production" : "staging" });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    await db.onrampOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
    throw new ApiError(502, "PROVIDER_ERROR", e instanceof Error ? e.message : "Transak unavailable");
  }
});
