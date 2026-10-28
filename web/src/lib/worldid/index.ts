import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { normalizeSigningKey } from "./signing-key";
import { onchainEnabled, verifyOnChain } from "./onchain";
import { ApiError } from "../http";
import { getOverride, notConfigured, requireEnv } from "../config";

/** Legacy (IDKit <=3 / v2-style) proof fields, still accepted from older clients. */
export interface LegacyWorldIdProof {
  nullifier_hash: string;
  merkle_root?: string;
  proof: string;
  verification_level?: string;
  signal?: string;
}
/** The complete IDKit 4.x result, forwarded to the Developer Portal v4 verify endpoint unmodified. */
export interface IdkitResult {
  protocol_version: string;
  nonce?: string;
  action?: string;
  environment?: string;
  responses: { identifier: string; nullifier?: string; proof?: unknown; signal_hash?: string; [k: string]: unknown }[];
  [k: string]: unknown;
}
export type WorldIdProof = LegacyWorldIdProof | IdkitResult;
export const isIdkitResult = (p: WorldIdProof): p is IdkitResult => Array.isArray((p as IdkitResult).responses);

export type WorldIdResult = { ok: true; nullifier: string } | { ok: false; reason: string };

export interface WorldIdVerifier {
  readonly mode: string;
  /** `signal` (optional) must match what the proof was bound to (e.g. campaign+split hash). */
  verify(proof: WorldIdProof, action: string, signal?: string): Promise<WorldIdResult>;
}

export const worldIdAction = () => process.env.WORLD_ID_ACTION || "clippo-creator-signup";
const expectedEnv = () => process.env.WORLD_ID_ENVIRONMENT || "production";

function signingKeyOrThrow(): string {
  const raw = requireEnv("World ID", "WORLD_ID_SIGNING_KEY");
  try {
    return normalizeSigningKey(raw);
  } catch (e) {
    throw new ApiError(503, "NOT_CONFIGURED", (e as Error).message);
  }
}

export function worldIdConfig() {
  return {
    appId: requireEnv("World ID", "WORLD_ID_APP_ID"),
    rpId: requireEnv("World ID", "WORLD_ID_RP_ID"),
    signingKey: signingKeyOrThrow(),
  };
}

/** Backend-signed RP context the IDKit widget needs (never sign client-side; the key stays server-only). */
export function createRpContext(action: string) {
  const { rpId, appId, signingKey } = worldIdConfig();
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: signingKey, action });
  return { app_id: appId, rp_id: rpId, action, environment: expectedEnv(), nonce, created_at: createdAt, expires_at: expiresAt, signature: sig };
}

/** Normalise any accepted payload into the body for POST /api/v4/verify/{rp_id}. */
export function toVerifyBody(p: WorldIdProof, action: string) {
  if (isIdkitResult(p)) return { ...p, action: p.action ?? action, environment: expectedEnv() };
  return {
    protocol_version: "3.0",
    action,
    environment: expectedEnv(),
    responses: [
      {
        identifier: p.verification_level || "orb",
        merkle_root: p.merkle_root,
        nullifier: p.nullifier_hash,
        proof: p.proof,
        ...(p.signal ? { signal_hash: hashSignal(p.signal) } : {}),
      },
    ],
  };
}

/** Real verifier: World Developer Portal v4 (IDKit 4.x / World ID 4.0 + legacy 3.0 proofs). */
export class RealWorldId implements WorldIdVerifier {
  readonly mode = "real" as const;
  async verify(proof: WorldIdProof, action: string, signal?: string): Promise<WorldIdResult> {
    const { rpId } = worldIdConfig();
    const body = toVerifyBody(proof, action);
    if (isIdkitResult(proof) && proof.action && proof.action !== action) return { ok: false, reason: "World ID proof was made for a different action" };
    if (isIdkitResult(proof) && proof.environment && proof.environment !== expectedEnv()) return { ok: false, reason: "World ID proof is from the wrong environment" };
    if (signal !== undefined) {
      const want = hashSignal(signal).toLowerCase();
      const got = (body.responses as { signal_hash?: string }[]).map((r) => r.signal_hash?.toLowerCase());
      if (!got.length || got.some((g) => g !== want)) return { ok: false, reason: "World ID proof is not bound to this approval" };
    }
    let res: Response;
    try {
      res = await fetch(`https://developer.world.org/api/v4/verify/${encodeURIComponent(rpId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw notConfigured("World ID verify API unreachable; check network and", "WORLD_ID_RP_ID");
    }
    const j = (await res.json().catch(() => ({}))) as {
      success?: boolean; environment?: string; nullifier?: string; detail?: string; message?: string; code?: string;
      results?: { nullifier?: string; success?: boolean; detail?: string }[];
    };
    if (!res.ok || j.success !== true) return { ok: false, reason: j.detail ?? j.message ?? `World ID rejected the proof (${res.status})` };
    if (j.environment && j.environment !== expectedEnv()) return { ok: false, reason: "World ID verified in the wrong environment" };
    const nullifier = j.nullifier ?? j.results?.find((r) => r.success)?.nullifier ?? (isIdkitResult(proof) ? (proof.responses[0]?.nullifier as string | undefined) : proof.nullifier_hash);
    if (!nullifier) return { ok: false, reason: "World ID returned no nullifier" };
    if (onchainEnabled()) {
      const oc = await verifyOnChain(proof, rpId, action);
      if (!oc.ok) return oc;
    }
    return { ok: true, nullifier };
  }
}

export function getWorldId(): WorldIdVerifier {
  return getOverride<WorldIdVerifier>("worldId") ?? new RealWorldId();
}
