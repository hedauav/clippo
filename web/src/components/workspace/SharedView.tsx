"use client";
import { useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAsync } from "../hooks";
import { ws, errText } from "../api";
import { Correction, DemoNote, Empty, Loading, PageHead, TickBar } from "../Bits";
import { money } from "./parts";
import { ApprovalLedger, BriefSpec, TrackingList, approvedTotal, isFunded } from "./panels";

/** Read-only copy of a workspace for the campaigner and every creator on it. No controls, no wallet. */
export function SharedView() {
  const { token } = useParams<{ token: string }>();
  const fn = useCallback(() => ws.shared(token), [token]);
  const r = useAsync(fn);

  if (r.status === "loading") return <div className="wrap page"><Loading label="Pulling the shared copy" rows={6} /></div>;
  if (r.status === "error") return <div className="wrap page"><Correction what="The shared view did not load." fix={errText(r.error)} onRetry={r.retry} /></div>;
  if (!r.data)
    return (
      <div className="wrap page">
        <Empty title="Nothing at this address." action={<Link href="/hire" className="btn sm">Go to Hire</Link>}>
          The link may be cut short, or the campaigner has withdrawn it. Ask them for a new one.
        </Empty>
      </div>
    );

  const w = r.data;
  const funded = isFunded(w);
  const total = approvedTotal(w.lines);
  const cap = w.cap;
  const pct = cap ? (total / cap) * 100 : 0;

  return (
    <div className="wrap page">
      <PageHead kicker={<><span>Shared view</span><span>No. {w.serial}</span><span>{funded ? "Funded" : "Draft"}</span></>} title={<>{w.title}</>}>
        {w.brief?.brand ? `${w.brief.brand} is hiring` : "Hiring"} {w.lines.length} creators. Everyone on the campaign sees the same page.
      </PageHead>
      <DemoNote />
      <p className="ws-readonly" role="note">
        <span className="micro">Read only</span>
        <span>Nothing here can be changed from this link. {funded ? "Payment is released per creator once the clip passes verification." : "Funds move only after the campaigner approves and funds."}</span>
      </p>

      <div className="cols flip ws-cols" style={{ marginTop: 24 }}>
        <div className="stack-lg">
          <section aria-labelledby="h-led">
            <div className="section-title"><h2 id="h-led">Offers</h2></div>
            <ApprovalLedger w={w} />
          </section>
          <section aria-labelledby="h-trk">
            <div className="section-title"><h2 id="h-trk">Tracking</h2></div>
            <TrackingList w={w} />
          </section>
        </div>
        <aside className="rail" aria-label="Brief and budget">
          <div className="ws-total">
            <span className="micro">{funded ? "In escrow" : "Approved so far"}</span>
            <div className="big">
              <span className="fig-xl">${money(total, 0)}</span>
              {cap != null && <span className="micro">of ${money(cap, 0)} cap</span>}
            </div>
            {cap != null && <TickBar pct={pct} sig label={`${Math.round(pct)} percent of the budget cap approved`} />}
          </div>
          <span className="micro">The brief</span>
          <BriefSpec w={w} />
        </aside>
      </div>
    </div>
  );
}
