"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Eye } from "./Icons";
import { ApiError, DEMO, type WorldProof } from "./api";

export type WorldResult = "verified" | "cancelled" | "expired" | "repeated" | "failed";

const ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "clippo-creator-signup";
const LEVEL = process.env.NEXT_PUBLIC_WORLD_LEVEL === "device" ? "device" : "orb";

const IDKitSheet = dynamic(() => import("./IDKitSheet"), { ssr: false });

/**
 * World ID check. Real IDKit widget; the backend signs each request (/api/worldid/rp-signature) and says which app and action to use. The widget returns a proof or a failure kind;
 * the CALLER sends the proof to the backend (which verifies it and may still refuse: reused, denied, expired) and
 * decides what the proof is for. Every proof here is fresh: callers must open a new check per action/approver.
 *
 * `onResult("verified", proof)` or `onResult(<failure>, undefined, message)`. Each failure leaves the action undone.
 */
export function WorldCheck({ purpose, kind, action = ACTION, signal, onResult }: { purpose: string; kind: "proof-of-human" | "agent-pass"; action?: string; /** Binds the proof to this exact approval (e.g. `split:<campaign>:<hash>`); the backend rejects a proof made for anything else. */ signal?: string; onResult: (r: WorldResult, proof?: WorldProof, message?: string) => void }) {
  const [unconf, setUnconf] = useState<string | null>(null);
  if (DEMO) return <Simulator purpose={purpose} kind={kind} onResult={onResult} />;
  if (unconf !== null) return <NotConfigured purpose={purpose} detail={unconf} onClose={() => onResult("cancelled", undefined, "World ID is not configured on this deployment, so nothing was checked.")} />;
  return (
    <IDKitSheet
      action={action}
      level={LEVEL}
      signal={signal}
      onProof={(p) => onResult("verified", p)}
      onFail={(f) => (f.kind === "unconfigured" ? setUnconf(f.message) : onResult(f.kind, undefined, f.message))}
    />
  );
}

function NotConfigured({ purpose, detail, onClose }: { purpose: string; detail: string; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="sheet-back" role="presentation">
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="wc-t" aria-describedby="wc-d">
        <span className="micro">World ID · Not configured</span>
        <h2 id="wc-t" className="display" style={{ fontSize: "2rem" }}><Eye size={26} /> {purpose}</h2>
        <p id="wc-d" className="muted">
          World ID is not set up on this deployment, so the check cannot run. Nothing was changed. An operator needs to add the World ID app, RP id and signing key. {detail}
        </p>
        <div className="row"><button ref={btn} className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

/** Screenshot-only (NEXT_PUBLIC_DEMO=1): walk the outcomes without a World ID app. */
function Simulator({ purpose, kind, onResult }: { purpose: string; kind: "proof-of-human" | "agent-pass"; onResult: (r: WorldResult, proof?: WorldProof, message?: string) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onResult("cancelled");
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onResult]);
  const proof = (p: string): WorldProof => ({ nullifier_hash: `n-${crypto.randomUUID()}`, proof: p });
  return (
    <div className="sheet-back" role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="wc-t">
        <span className="micro">{kind === "agent-pass" ? "World ID · Agent Pass" : "World ID · Proof of Human"} · demo</span>
        <h2 id="wc-t" className="display" style={{ fontSize: "2rem" }}><Eye size={26} /> {purpose}</h2>
        <p className="muted">Demo build: no World ID app is wired. Pick an outcome.</p>
        <div className="stack" style={{ gap: 10 }}>
          <button ref={first} className="btn" onClick={() => onResult("verified", proof("demo-proof"))}>Verify as a unique human</button>
          <div className="row">
            <button className="btn ghost sm" onClick={() => onResult("cancelled")}>Cancel</button>
            <button className="btn ghost sm" onClick={() => onResult("verified", proof("expired"))}>Let it expire</button>
            <button className="btn ghost sm" onClick={() => onResult("verified", proof("repeated"))}>Reuse an old proof</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const WORLD_FAIL: Record<Exclude<WorldResult, "verified">, string> = {
  cancelled: "You cancelled the check. Nothing was changed.",
  expired: "The check expired before it finished. Nothing was changed. Start again.",
  repeated: "That proof was already used. Each check works once. Nothing was changed.",
  failed: "World ID could not complete the check. Nothing was changed.",
};

/** Honest text for a failed World ID step: widget-side failures (kind + message) and backend refusals (ApiError). */
export function worldFailText(e: unknown, r?: WorldResult, message?: string): string {
  if (e instanceof ApiError) {
    if (e.code === "PROOF_REUSED") return WORLD_FAIL.repeated;
    if (e.code === "ALREADY_USED") return "This World ID is already linked to another Clippo account. Nothing was changed.";
    if (e.code === "ACCOUNT_ALREADY_VERIFIED") return "This account is already verified with a different World ID. Nothing was changed.";
    if (e.code === "NOT_CONFIGURED") return "World ID is not configured on this deployment, so nothing was checked.";
    if (e.code === "WORLD_ID_DENIED") return `${e.message}. Nothing was changed, and the proof was not consumed.`.replace(/\.\. /g, ". ");
    return e.message;
  }
  if (r && r !== "verified") return `${message ?? WORLD_FAIL[r]} ${message ? "Nothing was changed." : ""}`.trim();
  return e instanceof Error ? e.message : "The check did not complete. Nothing was changed.";
}
