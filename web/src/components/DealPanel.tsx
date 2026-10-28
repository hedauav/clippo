"use client";
import "./ext.css";
import { useCallback, useState } from "react";
import type { Campaign } from "@/ui-mocks/data";
import type { Deal } from "@/ui-mocks/ext";
import { extActions, errText } from "./api";
import { useAsync, useSession } from "./hooks";
import { Correction, DemoNote, Loading } from "./Bits";
import { money } from "./format";

const WHO = { creator: "Creator", campaigner: "Campaigner", negotiator: "Negotiator" } as const;

function Band({ deal, listed }: { deal: Deal; listed: number }) {
  const { minRate, maxRate } = deal.limits;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - minRate) / (maxRate - minRate)) * 100))}%`;
  const last = deal.offers[deal.offers.length - 1]?.rate;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="micro">Allowed band, USDC per 1K views</span>
      <div className="x-band" role="img" aria-label={`Allowed ${minRate.toFixed(2)} to ${maxRate.toFixed(2)}. Listed rate ${listed.toFixed(2)}. Latest offer ${last?.toFixed(2) ?? "none"}.`}>
        <div className="span" style={{ left: 0, width: pos(deal.limits.autoAcceptUpTo) }} />
        <i style={{ left: pos(listed) }} />
        {last !== undefined && <i className="s" style={{ left: pos(last) }} />}
      </div>
      <div className="row-between x-mono-line">
        <span>${minRate.toFixed(2)} floor</span>
        <span>hatched: negotiator accepts alone, up to ${deal.limits.autoAcceptUpTo.toFixed(2)}</span>
        <span>${maxRate.toFixed(2)} ceiling</span>
      </div>
    </div>
  );
}

export function DealPanel({ c }: { c: Campaign }) {
  const s = useSession();
  const side = s.role === "campaigner" ? "campaigner" : "creator";
  const fn = useCallback(() => extActions.deal(c.id), [c.id]);
  const q = useAsync(fn);
  const [over, setOver] = useState<Deal | null | undefined>(undefined);
  const deal = over !== undefined ? over : q.data;
  const loadErr = q.status === "error" ? q.error : "";
  const load = q.retry;
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(f: () => Promise<Deal>) {
    setBusy(true);
    setErr("");
    try {
      setOver(await f());
      setRate("");
      setNote("");
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }

  if (c.mode !== "per_view") return null;
  if (s.ready && !s.address) return null;
  if (s.role === "admin") return null;

  const body = () => {
    if (loadErr) return <Correction what="The deal could not be loaded." fix={loadErr} cause={loadErr} onRetry={load} />;
    if (deal === undefined) return <Loading label="Opening the deal file" rows={3} />;
    const lim = deal?.limits;
    const open = !deal || deal.status === "PROPOSED" || deal.status === "COUNTERED";
    const last = deal?.offers[deal.offers.length - 1];
    const myTurn = !!last && last.by !== side;
    const n = Number(rate);
    const outside = !!lim && rate !== "" && (n < lim.minRate || n > lim.maxRate);
    return (
      <>
        {deal && lim && (
          <>
            <div className="row-between">
              <span className={`x-label ${deal.status === "ACCEPTED" ? "ok" : deal.status === "DECLINED" || deal.status === "EXPIRED" ? "no" : "hold"}`}>{deal.status === "COUNTERED" ? "Countered" : deal.status === "PROPOSED" ? "Proposed" : deal.status === "ACCEPTED" ? "Agreed" : deal.status === "DECLINED" ? "Declined" : "Expired"}</span>
              <span className="x-mono-line">Pool left ${money(lim.poolLeft, 0)} USDC</span>
            </div>
            <Band deal={deal} listed={c.rate} />
            <ol className="x-offers" aria-live="polite">
              {deal.offers.map((o, i) => (
                <li className="x-offer" key={i} data-last={i === deal.offers.length - 1}>
                  <span className="who">{WHO[o.by]}</span>
                  <span className="note" style={{ fontSize: "0.875rem" }}>{o.note || "No note."}<span className="micro" style={{ display: "block", fontStyle: "normal" }}>{o.at}</span></span>
                  <span className="rate">${money(o.rate)}</span>
                </li>
              ))}
            </ol>
            <div className="x-sign" aria-label="Both sides must accept">
              {(["creator", "campaigner"] as const).map((k) => (
                <div key={k}>
                  <span className="micro">{WHO[k]} {deal.acceptedBy[k] ? "accepted" : "has not accepted"}</span>
                  <b className="display" style={{ fontSize: "1.2rem", color: deal.acceptedBy[k] ? "var(--ok)" : "var(--ink-3)" }}>{deal.acceptedBy[k] ? "Signed" : "Open"}</b>
                </div>
              ))}
            </div>
            {deal.status === "ACCEPTED" && <p className="note" role="status"><span className="micro">Agreed</span>Both sides accepted ${money(last!.rate)} per 1K views. This rate applies to this creator&rsquo;s approved clips from now on.</p>}
          </>
        )}
        {open && (
          <div className="stack">
            {deal && myTurn && !deal.acceptedBy[side] && (
              <div className="row" style={{ gap: 18 }}>
                <button className="btn sm" disabled={busy} onClick={() => run(() => extActions.accept(c.id, side))}>Accept ${money(last!.rate)}</button>
                <button className="linkbtn" disabled={busy} onClick={() => run(() => extActions.decline(c.id))}>Decline</button>
              </div>
            )}
            {deal && deal.acceptedBy[side] && <p className="x-mono-line" role="status">You accepted. Waiting for the {side === "creator" ? "campaigner" : "creator"}.</p>}
            {side === "campaigner" && <p className="muted" style={{ fontSize: "0.875rem" }}>Campaigners answer offers here. Counter-offers and standing limits need a named creator, which this panel does not select yet.</p>}
            {side === "creator" && <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!outside && n > 0) run(() => extActions.propose(c.id, side, n, note.trim())); }} noValidate>
              <span className="micro">{deal ? "Or counter" : "Make an offer"}</span>
              <div className={`field${outside ? " bad" : ""}`}>
                <label htmlFor="dr">Rate</label>
                <div className="unit"><input id="dr" type="number" min={0} step={0.1} value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={outside} /><span>USDC / 1K views</span></div>
                {outside && lim && <span className="err" role="alert">Outside the band: ${lim.minRate.toFixed(2)} to ${lim.maxRate.toFixed(2)}. The negotiator cannot take this.</span>}
              </div>
              <div className="field">
                <label htmlFor="dn">Note</label>
                <input id="dn" value={note} onChange={(e) => setNote(e.target.value)} placeholder={side === "creator" ? "Your recent views, why this rate" : "Why this rate"} />
              </div>
              <button className="btn sm ghost" style={{ justifySelf: "start" }} disabled={busy || !(n > 0) || outside}>{busy ? "Sending" : deal ? "Send counter" : "Send offer"}</button>
            </form>}
          </div>
        )}
        {err && <p className="notice warn" role="alert"><b>Not sent.</b>{err}</p>}
      </>
    );
  };

  return (
    <section className="x-box" aria-labelledby="dl-h">
      <div className="x-cap" style={{ borderTop: 0, paddingTop: 0 }}>
        <h3 id="dl-h" className="x-head">Rate deal</h3>
        <span className="micro">Listed ${money(c.rate)} per 1K</span>
      </div>
      <p className="muted" style={{ fontSize: "0.9rem" }}>The negotiator trades offers inside the band the campaigner set. Anything outside goes to a person. Money moves only when both sides accept.</p>
      <DemoNote />
      {body()}
    </section>
  );
}
