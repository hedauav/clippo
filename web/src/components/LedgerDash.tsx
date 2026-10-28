"use client";
import Link from "next/link";
import { mk, modules } from "./api";
import { useAsync } from "./hooks";
import { Correction, Empty, Loading } from "./Bits";
import { compact, money, whole } from "./format";
import { TierMark } from "./Marks";
import { VerifiedMark } from "./Icons";
import "./market.css";

const VD = { approved: ["ok", "Approved"], rejected: ["no", "Rejected"], needs_human: ["hold", "Needs human"], pending: ["pending", "Pending"] } as const;

/** Standing line at the top of the ledger: verified mark, tier, record, and owed against claimed. */
export function CreatorHead() {
  const d = useAsync(mk.creatorDash);
  if (d.status === "loading") return <Loading label="Reading your record" rows={3} />;
  if (d.status === "error") return null;
  const { rank, totals, verified } = d.data;
  return (
    <section className="stack" aria-labelledby="rec" style={{ marginBottom: 48 }}>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <h2 id="rec">Your record</h2>
        <span className="row" style={{ gap: 8 }}>
          {verified ? <><VerifiedMark size={16} /><span className="micro">Verified human</span></> : <Link href="/join" className="linkbtn">Verify with World ID</Link>}
          <TierMark tier={rank.tier} />
        </span>
      </div>
      <dl className="stats">
        <div><dt className="micro">Verified views</dt><dd className="fig">{compact(totals.views)}</dd></div>
        <div><dt className="micro">Clips sent</dt><dd className="fig">{whole(totals.submitted)}</dd></div>
        <div><dt className="micro">Approved / rejected</dt><dd className="fig">{totals.approved}<small>/</small>{totals.rejected}</dd></div>
        <div><dt className="micro">Reliability</dt><dd className="fig">{Math.round(rank.reliability * 100)}<small>%</small></dd></div>
      </dl>
      <div className="owed" role="group" aria-label="Owed and claimed">
        <div><span className="micro">Owed, claimable now</span><span className="fig">${money(totals.claimable)}</span></div>
        <div><span className="micro">Claimed</span><span className="fig">${money(totals.claimed)}</span></div>
        <div><span className="micro">Still accruing, est.</span><span className="fig">${money(totals.estimated)}</span></div>
      </div>
    </section>
  );
}

/** Every clip the creator sent, with the agent's verdict and reason. */
export function MySubmissions() {
  const s = useAsync(mk.mySubmissions);
  return (
    <section className="stack" aria-labelledby="subs">
      <div className="section-title" style={{ marginBottom: 0 }}><h2 id="subs">Your clips</h2><span className="micro">With verdicts</span></div>
      {s.status === "loading" && <Loading label="Pulling your clips" rows={3} />}
      {s.status === "error" && <Correction what="Your clips did not load." cause={s.error} onRetry={s.retry} />}
      {s.status === "ready" && s.data.length === 0 && <Empty title="No clips sent.">Open a campaign on the wire and paste a link. The verdict lands here.</Empty>}
      {s.status === "ready" && s.data.length > 0 && (
        <div className="ledger-wrap">
          <table className="ledger reflow">
            <caption className="sr">Submitted clips and verdicts</caption>
            <thead><tr><th scope="col">Clip</th><th scope="col">Verdict</th><th scope="col" className="n">Conf.</th><th scope="col" className="n">Views</th></tr></thead>
            <tbody>
              {s.data.map((x) => {
                const [k, label] = VD[x.verdict];
                return (
                  <tr key={x.id}>
                    <td className="lead-cell">
                      <a href={x.url} target="_blank" rel="noreferrer noopener" className="handle">{x.title}</a>
                      <span className="sub">{x.campaign} · {x.at}</span>
                      {x.reason && <span className="note" style={{ marginTop: 6 }}><span className="micro">Agent note</span>{x.reason}</span>}
                    </td>
                    <td data-l="Verdict"><span className={`vd ${k}`}>{label}</span>{x.appeal === "open" && <span className="micro" style={{ display: "block", marginTop: 4 }}>Appeal open</span>}</td>
                    <td className="n" data-l="Confidence">{x.confidence ? x.confidence.toFixed(2) : "–"}</td>
                    <td className="n" data-l="Views">{x.views ? compact(x.views) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Links to optional modules. Each link exists only if its endpoint answers; otherwise nothing renders. */
const probeModules = async () => {
  const [ladder, ref, prof] = await Promise.all([modules.ladder(), modules.referral(), modules.profile()].map((p) => p.catch(() => null)));
  return { ladder: !!ladder, ref: !!ref, prof: !!prof };
};
export function ModuleLinks() {
  const a = useAsync(probeModules);
  if (a.status !== "ready" || !(a.data.ladder || a.data.ref || a.data.prof)) return null;
  return (
    <nav className="row" aria-label="More for creators" style={{ gap: 20, marginTop: 8 }}>
      {a.data.ladder && <Link href="/status" className="linkbtn">Status ladder</Link>}
      {a.data.ref && <Link href="/referrals" className="linkbtn">Referral links</Link>}
      {a.data.prof && <Link href="/profile" className="linkbtn">On-chain profile</Link>}
    </nav>
  );
}
