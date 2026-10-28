"use client";
import { useCallback, useState } from "react";
import { mk } from "./api";
import { useAsync } from "./hooks";
import { Correction, DemoNote, Empty, Loading, TickBar } from "./Bits";
import { compact, money, whole } from "./format";
import { Byline } from "./Marks";
import type { DailyPoint, DeskCampaign, DeskData } from "@/ui-mocks/market";
import "./market.css";

const cp = (n: number | null) => (n === null ? "no views yet" : `$${money(n)}`);

export function DailyChart({ days }: { days: DailyPoint[] }) {
  if (days.length === 0) return <p className="note"><span className="micro">Daily views</span>No daily counts yet. The first bar lands after the next view snapshot.</p>;
  const W = 1000, H = 200, L = 48, B = 26, T = 10;
  const max = Math.max(1, ...days.map((d) => d.views));
  const bw = (W - L) / days.length;
  const peak = days.reduce((a, d, i) => (d.views > days[a].views ? i : a), 0);
  const ticks = [0, 0.5, 1];
  return (
    <figure className="stack" style={{ gap: 8 }}>
      <svg className="daily" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Verified views per day over ${days.length} days. Peak ${whole(days[peak].views)} on ${days[peak].day}.`}>
        {ticks.map((t) => {
          const y = H - B - t * (H - B - T);
          return (
            <g key={t}>
              <line className="ax" x1={L} x2={W} y1={y} y2={y} />
              <text x={L - 6} y={y + 3} textAnchor="end">{compact(Math.round(max * t))}</text>
            </g>
          );
        })}
        {days.map((d, i) => {
          const h = (d.views / max) * (H - B - T);
          return <rect key={d.day} className={`col${i === peak ? " peak" : ""}`} x={L + i * bw + bw * 0.25} y={H - B - h} width={Math.max(2, bw * 0.5)} height={h}><title>{`${d.day}: ${whole(d.views)} views`}</title></rect>;
        })}
        <line className="base" x1={L} x2={W} y1={H - B} y2={H - B} />
        <text x={L} y={H - 8}>{days[0].day.slice(5)}</text>
        <text x={W} y={H - 8} textAnchor="end">{days[days.length - 1].day.slice(5)}</text>
      </svg>
      <figcaption className="micro">Verified views per day. Peak day in orange: {days[peak].day.slice(5)}, {whole(days[peak].views)}.</figcaption>
    </figure>
  );
}

function ClipSplit({ approved, rejected, pending }: { approved: number; rejected: number; pending: number }) {
  const total = approved + rejected + pending;
  if (total === 0) return <p className="muted" style={{ fontSize: "0.9rem" }}>No clips judged yet.</p>;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="split-bar" role="img" aria-label={`${approved} approved, ${rejected} rejected, ${pending} waiting for a person`}>
        <i className="ok" style={{ width: pct(approved) }} />
        <i className="no" style={{ width: pct(rejected) }} />
        <i className="hold" style={{ width: pct(pending) }} />
      </div>
      <div className="legend">
        <span className="ok">Approved {approved}</span>
        <span className="no">Rejected {rejected}</span>
        <span className="hold">Needs human {pending}</span>
      </div>
    </div>
  );
}

function One({ c }: { c: DeskCampaign }) {
  const dailyFn = useCallback(() => mk.daily(c.campaignId), [c.campaignId]);
  const perFn = useCallback(() => mk.creators(c.campaignId, c.views && c.spend ? (c.spend / c.views) * 1000 : 0), [c.campaignId, c.views, c.spend]);
  const daily = useAsync(dailyFn);
  const per = useAsync(perFn);
  const pct = c.budget ? (c.spend / c.budget) * 100 : 0;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row-between">
          <span className="micro">Spend against budget</span>
          <span className="fig" style={{ fontSize: "0.875rem" }}>${money(c.spend)} of ${money(c.budget, 0)} · ${money(c.remaining)} left</span>
        </div>
        <TickBar pct={pct} big sig label={`${Math.round(pct)} percent of the budget spent`} />
      </div>

      <div className="two">
        <div className="stack" style={{ gap: 10 }}>
          <span className="micro">Clips, approved and rejected</span>
          <ClipSplit approved={c.approved} rejected={c.rejected} pending={c.pending} />
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="micro">Cost per 1,000 views</span>
          <div className="fig-xl" style={{ fontSize: "2.4rem" }}>{cp(c.cpm1k)}</div>
          <span className="muted" style={{ fontSize: "0.875rem" }}>Spend divided by verified views on approved clips.</span>
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="micro">Daily views</span>
        {daily.status === "loading" && <Loading label="Pulling the daily count" rows={3} />}
        {daily.status === "error" && <Correction what="Daily views did not load." cause={daily.error} onRetry={daily.retry} />}
        {daily.status === "ready" && <DailyChart days={daily.data} />}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="micro">Per creator</span>
        {per.status === "loading" && <Loading label="Tallying creators" rows={3} />}
        {per.status === "error" && <Correction what="Creator performance did not load." cause={per.error} onRetry={per.retry} />}
        {per.status === "ready" && per.data.length === 0 && <Empty title="No creators yet.">Clips show up here the moment someone submits one.</Empty>}
        {per.status === "ready" && per.data.length > 0 && (
          <div className="ledger-wrap">
            <table className="ledger reflow">
              <caption className="sr">Performance per creator for {c.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Creator</th>
                  <th scope="col" className="n">Clips</th>
                  <th scope="col" className="n">Approved</th>
                  <th scope="col" className="n">Rejected</th>
                  <th scope="col" className="n">Views</th>
                  <th scope="col" className="n">Cost, USDC</th>
                  <th scope="col" className="n">Per 1K</th>
                </tr>
              </thead>
              <tbody>
                {per.data.map((r) => (
                  <tr key={r.creator}>
                    <td className="lead-cell"><Byline name={r.creator} verified={r.verified} tier={r.tier} /></td>
                    <td className="n" data-l="Clips">{r.clips}</td>
                    <td className="n" data-l="Approved">{r.approved}</td>
                    <td className="n" data-l="Rejected">{r.rejected}</td>
                    <td className="n" data-l="Views">{compact(r.views)}</td>
                    <td className="n" data-l="Cost, USDC">{money(r.paid)}</td>
                    <td className="n" data-l="Per 1K">{r.cpm1k === null ? "–" : `$${money(r.cpm1k)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function DeskAnalytics() {
  const d = useAsync(mk.deskDash);
  const [sel, setSel] = useState<string | null>(null);

  if (d.status === "loading") return <Loading label="Adding up the books" rows={4} />;
  if (d.status === "error") return <Correction what="Your numbers did not load." fix="Connect a campaigner wallet, then try again." cause={d.error} onRetry={d.retry} />;
  const data: DeskData = d.data;
  if (data.campaigns.length === 0) return null;
  const chosen = data.campaigns.find((c) => c.campaignId === sel) ?? data.campaigns[0];
  const t = data.totals;

  return (
    <section className="stack-lg" aria-labelledby="numbers" style={{ marginBottom: 56 }}>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <h2 id="numbers">The numbers</h2>
        <span className="micro">All campaigns</span>
      </div>
      <DemoNote />
      <dl className="stats">
        <div><dt className="micro">Budget</dt><dd className="fig">${money(t.budget, 0)}</dd></div>
        <div><dt className="micro">Spend</dt><dd className="fig">${money(t.spend)}</dd></div>
        <div><dt className="micro">Verified views</dt><dd className="fig">{compact(t.views)}</dd></div>
        <div><dt className="micro">Per 1K views</dt><dd className="fig">{cp(t.cpm1k)}</dd></div>
        <div><dt className="micro">Approved / rejected</dt><dd className="fig">{t.approved}<small>/</small>{t.rejected}</dd></div>
      </dl>

      <div className="stack">
        <div className="row-between">
          <h3 className="display h3">{chosen.title}</h3>
          {data.campaigns.length > 1 && (
            <div className="pick" role="group" aria-label="Campaign">
              {data.campaigns.map((c) => (
                <button key={c.campaignId} aria-pressed={c.campaignId === chosen.campaignId} onClick={() => setSel(c.campaignId)}>{c.title}</button>
              ))}
            </div>
          )}
        </div>
        <One key={chosen.campaignId} c={chosen} />
      </div>
    </section>
  );
}
