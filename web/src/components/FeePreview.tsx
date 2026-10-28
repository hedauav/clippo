"use client";
import { useEffect, useState } from "react";
import { mk } from "./api";
import { money } from "./format";
import type { Fees } from "@/ui-mocks/market";
import "./market.css";

let cached: Promise<Fees> | null = null;
/** The live fee schedule (GET /api/chain/config). null while loading, "failed" when the service did not say: callers must not invent a number. */
export function useFees(): Fees | null | "failed" {
  const [f, setF] = useState<Fees | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    cached ??= mk.fees();
    cached.then(
      (x) => alive && setF(x),
      () => {
        cached = null;
        if (alive) setF("failed");
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return f;
}

export const pctText = (bps: number) => `${(bps / 100).toFixed(2)}%`;

const cents = (n: number) => Math.round(n * 100) / 100;

/** What the fee will be, as a receipt. Fund: the campaigner-side fee comes out of the pool. Claim: the creator-side fee comes out of the payout. */
export function FeePreview({ kind, amount }: { kind: "fund" | "claim"; amount: number }) {
  const f = useFees();
  if (f === "failed") return <div className="receipt" role="alert"><span className="micro">Fee preview</span><span className="muted" style={{ fontSize: "0.875rem" }}>The fee schedule could not be read from the service, so no figure is shown. Reload to try again.</span></div>;
  if (!f) return <div className="receipt" aria-busy="true"><span className="micro">Fee preview</span><span className="muted" style={{ fontSize: "0.875rem" }}>Reading the fee schedule<span className="caret" aria-hidden="true" /></span></div>;
  const bps = kind === "fund" ? f.campaignerBps : f.creatorBps;
  const fee = cents((amount * bps) / 10000);
  const net = cents(amount - fee);
  return (
    <div className="receipt" aria-live="polite">
      <span className="micro">{kind === "fund" ? "Fee preview, funding" : "Fee preview, claim"}</span>
      {kind === "fund" ? (
        <>
          <div className="line"><span>Pool you send</span><span>{money(amount)}</span></div>
          <div className="line"><span>Platform fee, {pctText(bps)}</span><span>-{money(fee)}</span></div>
          <div className="line total"><span>Net pool for creators</span><span>{money(net)}</span></div>
        </>
      ) : (
        <>
          <div className="line"><span>Gross payout</span><span>{money(amount)}</span></div>
          <div className="line"><span>Platform fee, {pctText(bps)}</span><span>-{money(fee)}</span></div>
          <div className="line total"><span>You receive</span><span>{money(net)}</span></div>
        </>
      )}
      <span className="muted" style={{ fontSize: "0.75rem" }}>
        {pctText(f.campaignerBps)} on the campaigner side, {pctText(f.creatorBps)} on the creator side{", as set on the escrow."}
      </span>
    </div>
  );
}
