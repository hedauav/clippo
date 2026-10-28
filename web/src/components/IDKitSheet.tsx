"use client";
/* The real World ID widget (@worldcoin/idkit v4 IDKitRequestWidget). Loaded only on the client by WorldCheck.
   v4 needs an RP context signed by the backend (the signing key never reaches the browser): we ask `rpContext()` for a
   fresh one per check, so every check, approver and action gets its own nonce. The widget reports a proof or a failure
   kind. It never decides anything: the caller sends the proof to the backend, which verifies it. */
import { useCallback, useEffect, useRef, useState } from "react";
import { IDKitErrorCodes, IDKitRequestWidget, orbLegacy, deviceLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { ApiError } from "./api";

export type SheetProof = { nullifier_hash: string; proof: string; merkle_root?: string; verification_level?: string; idkitResult: IDKitResult };
export type SheetFail = { kind: "cancelled" | "expired" | "repeated" | "failed" | "unconfigured"; message: string };
type SignedCtx = RpContext & { app_id: string; action?: string; environment?: "production" | "staging" | "sandbox" };

const FAIL_OF: Partial<Record<IDKitErrorCodes, SheetFail>> = {
  [IDKitErrorCodes.VerificationRejected]: { kind: "cancelled", message: "You declined the request in World App." },
  [IDKitErrorCodes.UserRejected]: { kind: "cancelled", message: "You declined the request in World App." },
  [IDKitErrorCodes.Cancelled]: { kind: "cancelled", message: "You cancelled the check." },
  [IDKitErrorCodes.MaxVerificationsReached]: { kind: "repeated", message: "World ID says this check was already used the maximum number of times for this action." },
  [IDKitErrorCodes.NullifierReplayed]: { kind: "repeated", message: "World ID says this proof was already used." },
  [IDKitErrorCodes.ConnectionFailed]: { kind: "expired", message: "The connection to World App dropped before the check finished." },
  [IDKitErrorCodes.Timeout]: { kind: "expired", message: "The check timed out before it finished." },
  [IDKitErrorCodes.RpSignatureExpired]: { kind: "expired", message: "The check request expired before it was answered." },
  [IDKitErrorCodes.CredentialUnavailable]: { kind: "failed", message: "Your World ID does not have the credential this check needs." },
};

/** Pull the legacy (v3) fields out of an IDKit result so a v2-style verifier can read them; v4 results travel whole in `idkitResult`. */
function toProof(r: IDKitResult): SheetProof {
  const first = (r.responses?.[0] ?? {}) as unknown as Record<string, string | undefined>;
  return {
    nullifier_hash: first.nullifier ?? "",
    proof: typeof first.proof === "string" ? first.proof : JSON.stringify(first.proof ?? ""),
    merkle_root: first.merkle_root,
    verification_level: first.identifier,
    idkitResult: r,
  };
}

/** The backend signs the request (POST /api/worldid/rp-signature) and tells us the app id, action and environment to use. */
async function fetchRpContext(action: string): Promise<SignedCtx> {
  const res = await fetch("/api/worldid/rp-signature", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }), credentials: "same-origin" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? "ERROR", body?.error?.message ?? `World ID request could not be signed (${res.status}).`);
  return body.rpContext as SignedCtx;
}

export default function IDKitSheet({ action, level, signal, onProof, onFail }: { action: string; level: "orb" | "device"; signal?: string; onProof: (p: SheetProof) => void; onFail: (f: SheetFail) => void }) {
  const [ctx, setCtx] = useState<SignedCtx | null>(null);
  const [open, setOpen] = useState(true);
  const settled = useRef(false);
  const fail = useCallback(
    (f: SheetFail) => {
      if (settled.current) return;
      settled.current = true;
      onFail(f);
    },
    [onFail],
  );

  useEffect(() => {
    let alive = true;
    fetchRpContext(action).then(
      (c) => alive && setCtx(c),
      (e: unknown) => {
        if (!alive) return;
        const nc = e instanceof ApiError && (e.code === "NOT_CONFIGURED" || e.status === 503);
        fail({ kind: nc ? "unconfigured" : "failed", message: e instanceof Error ? e.message : "The check could not be started." });
      },
    );
    return () => {
      alive = false;
    };
  }, [action, fail]);

  if (!ctx) return null;
  return (
    <IDKitRequestWidget
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        /* closed before a proof or an error arrived: a cancellation. The delay lets success and close race safely. */
        if (!o) setTimeout(() => fail({ kind: "cancelled", message: "You closed the check before it finished." }), 600);
      }}
      app_id={ctx.app_id as `app_${string}`}
      action={ctx.action ?? action}
      environment={ctx.environment}
      rp_context={ctx}
      allow_legacy_proofs
      preset={level === "device" ? deviceLegacy({ signal }) : orbLegacy({ signal })}
      autoClose
      onSuccess={(r) => {
        if (settled.current) return;
        settled.current = true;
        onProof(toProof(r));
      }}
      onError={(code) => fail(FAIL_OF[code] ?? { kind: "failed", message: `World ID could not complete the check (${code}).` })}
    />
  );
}
