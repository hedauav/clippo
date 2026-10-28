import { isAddress, recoverMessageAddress } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { db } from "./db";
import { ApiError } from "./http";

/**
 * Sign-In with Ethereum (EIP-4361) over viem.
 *  1. GET  /api/auth/nonce                      -> { nonce, domain, uri, chainId, statement, expiresAt }
 *  2. wallet signs the EIP-4361 message (see buildSiweMessage / client.ts signIn)
 *  3. POST /api/auth/session { message, signature, role? } -> verified, session cookie set
 * Nonces are single-use and expire after 10 minutes. EOA signatures only (no ERC-1271/6492).
 */
const NONCE_TTL_MS = 10 * 60 * 1000;
export const SIWE_STATEMENT = "Sign in to Clippo. This request does not cost gas or move funds.";

/** Dev bypass (wallet-only sign-in, x-wallet header) exists ONLY when NODE_ENV is not "production". */
export const devAuthAllowed = () => process.env.NODE_ENV !== "production";

export async function issueNonce(req: Request) {
  const nonce = generateSiweNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await db.authNonce.create({ data: { nonce, expiresAt } });
  // opportunistic cleanup of old nonces
  await db.authNonce.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } });
  const domain = expectedDomain(req);
  return {
    nonce,
    domain,
    uri: `${new URL(req.url).protocol}//${domain}`,
    chainId: Number(process.env.ARC_CHAIN_ID || 5042002),
    statement: SIWE_STATEMENT,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Domain bound into the message: SIWE_DOMAIN env, else the request Host. */
export function expectedDomain(req: Request): string {
  return process.env.SIWE_DOMAIN || req.headers.get("host") || new URL(req.url).host;
}

/** Server-side helper that builds the exact message to sign (used by tests and documented for non-browser clients). */
export function buildSiweMessage(p: { address: `0x${string}`; nonce: string; domain: string; uri: string; chainId: number }) {
  return createSiweMessage({
    address: p.address,
    chainId: p.chainId,
    domain: p.domain,
    nonce: p.nonce,
    uri: p.uri,
    version: "1",
    statement: SIWE_STATEMENT,
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + NONCE_TTL_MS),
  });
}

/**
 * Verifies an EIP-4361 message + signature and consumes its nonce. Returns the lower-cased wallet.
 * Errors: 401 BAD_SIGNATURE / BAD_SIWE_MESSAGE / NONCE_INVALID.
 */
export async function verifySiwe(req: Request, message: string, signature: string): Promise<string> {
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || !isAddress(parsed.address)) {
    throw new ApiError(401, "BAD_SIWE_MESSAGE", "Malformed sign-in message");
  }
  const valid = validateSiweMessage({ message: parsed, domain: expectedDomain(req), address: parsed.address });
  if (!valid) throw new ApiError(401, "BAD_SIWE_MESSAGE", `Sign-in message is expired, for another domain, or malformed (this server expects domain "${expectedDomain(req)}"; open the app at that address)`);

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  } catch {
    throw new ApiError(401, "BAD_SIGNATURE", "Signature is not valid");
  }
  if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
    throw new ApiError(401, "BAD_SIGNATURE", "Signature does not match the wallet in the message");
  }

  // single-use nonce: the conditional update succeeds for exactly one caller
  const used = await db.authNonce.updateMany({
    where: { nonce: parsed.nonce, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (used.count !== 1) throw new ApiError(401, "NONCE_INVALID", "Nonce is unknown, expired or already used. Request a new one.");
  return parsed.address.toLowerCase();
}
