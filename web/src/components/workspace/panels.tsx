"use client";
import { StageTrack, fmtDate, money, whole } from "./parts";
import { Empty } from "../Bits";
import { TIER_LABEL, stageOf, type Line, type Status, type Workspace } from "@/ui-mocks/workspace";

export const approvedTotal = (lines: Line[]) => Math.round(lines.filter((l) => l.status === "APPROVED").reduce((a, l) => a + l.amount, 0) * 100) / 100;
export const isFunded = (w: Workspace) => w.status === "FUNDING";

const DEC_LABEL: Record<Status, string> = { PROPOSED: "Awaiting", APPROVED: "Approved", REJECTED: "Passed" };
const DEC_CLS: Record<Status, string> = { PROPOSED: "hold", APPROVED: "ok", REJECTED: "no" };

/** Ledger: one row per creator, running sum of approved amounts down the right edge. `controls` makes decisions editable. */
export function ApprovalLedger({ w, controls }: { w: Workspace; controls?: { onDecide: (creatorId: string, s: Status) => void } }) {
  const runs = w.lines.reduce<number[]>((a, l) => [...a, (a.length ? a[a.length - 1] : 0) + (l.status === "APPROVED" ? l.amount : 0)], []);
  const total = approvedTotal(w.lines);
  return (
    <div className="ledger-wrap">
      <table className="ledger reflow ws-ledger">
        <caption className="micro">Offers and approvals, USDC</caption>
        <thead>
          <tr>
            <th scope="col">Creator</th>
            <th scope="col">Rate line</th>
            <th scope="col" className="n">Amount</th>
            <th scope="col">Decision</th>
            <th scope="col" className="n">Running total</th>
          </tr>
        </thead>
        <tbody>
          {w.lines.map((l, i) => (
            <tr key={l.creatorId} data-d={l.status === "APPROVED" ? "approved" : l.status === "REJECTED" ? "passed" : "pending"}>
              <td className="lead-cell">
                <span className="name">{l.name}</span>
                <span className="sub">{TIER_LABEL[l.tier]}</span>
              </td>
              <td data-l="Rate line">{l.rateLabel}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</td>
              <td className="n" data-l="Amount">${money(l.amount)}</td>
              <td className="dec" data-l="Decision">
                {controls ? (
                  <span className="dec-btns" role="group" aria-label={`Decision for ${l.name}`}>
                    <button className="yes" aria-pressed={l.status === "APPROVED"} onClick={() => controls.onDecide(l.creatorId, l.status === "APPROVED" ? "PROPOSED" : "APPROVED")}>Approve</button>
                    <button className="no" aria-pressed={l.status === "REJECTED"} onClick={() => controls.onDecide(l.creatorId, l.status === "REJECTED" ? "PROPOSED" : "REJECTED")}>Pass</button>
                  </span>
                ) : (
                  <span className={`stamp ${DEC_CLS[l.status]}`}>{DEC_LABEL[l.status]}</span>
                )}
              </td>
              <td className="n run" data-l="Running total">{l.status === "APPROVED" ? `$${money(runs[i])}` : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="lead-cell">Approved total</td>
            <td className="n">&nbsp;</td>
            <td className="dec">&nbsp;</td>
            <td className="n" data-l="Total">${money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function TrackingList({ w }: { w: Workspace }) {
  const funded = isFunded(w);
  const rows = w.lines.filter((l) => l.status === "APPROVED");
  if (!funded)
    return (
      <Empty title="Tracking starts when the work is funded.">
        Once the approved creators are funded you will see each one move from funded to posted, verified and paid, with the clip link and verified views.
      </Empty>
    );
  if (rows.length === 0) return <Empty title="Nobody was approved.">Only approved creators are tracked.</Empty>;
  return (
    <div role="list" aria-label="Per-creator tracking">
      {rows.map((l) => {
        const stage = stageOf(l, funded);
        const clip = l.clips[0];
        return (
          <div className="ws-track-row" role="listitem" key={l.creatorId}>
            <div>
              <span className="name">{l.name}</span>
              <span className="micro" style={{ display: "block" }}>{l.rateLabel}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span>
            </div>
            <StageTrack stage={stage} />
            <div className="stat">
              <span>${money(l.amount)}</span>
              {stage === "funded" ? (
                <span className="muted">Waiting on the clip</span>
              ) : (
                <>
                  <span>{whole(l.views)} verified views</span>
                  <span className="muted">{l.approvedClips} of {l.clips.length} clips approved</span>
                  {clip && <a href={clip.link} target="_blank" rel="noreferrer noopener" style={{ fontSize: "0.72rem" }}>Open the clip</a>}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BriefSpec({ w }: { w: Workspace }) {
  const b = w.brief;
  if (!b) return <Empty title="No brief attached.">Funding needs a written brief. Write one from the directory.</Empty>;
  return (
    <div className="ws-spec">
      <div>
        <span className="micro">{[b.brand, b.objective].filter(Boolean).join(" · ")}</span>
        <p className="prose" style={{ marginTop: 6 }}>{b.summary}</p>
      </div>
      <div>
        <span className="micro">Every clip must say</span>
        <ul>{b.mustSay.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>
      {b.mustNot.length > 0 && (
        <div>
          <span className="micro">No clip may say</span>
          <ul>{b.mustNot.map((x, i) => <li className="no" key={i}>{x}</li>)}</ul>
        </div>
      )}
      <dl className="kv">
        <dt>Disclosure</dt><dd style={{ textAlign: "right", fontFamily: "var(--f-text)" }}>{b.disclosure || "none"}</dd>
        <dt>Deliver by</dt><dd>{fmtDate(b.due)}</dd>
        {w.cap != null && <><dt>Budget cap</dt><dd>${money(w.cap, 0)}</dd></>}
      </dl>
    </div>
  );
}
