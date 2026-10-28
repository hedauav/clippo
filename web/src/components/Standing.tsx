"use client";
import { useCallback, useState } from "react";
import { mk } from "./api";
import { useAsync } from "./hooks";
import { Correction, DemoNote, Empty, Loading } from "./Bits";
import { compact, money, whole } from "./format";
import { Byline } from "./Marks";
import "./market.css";

type Sort = "views" | "earnings";

/** Standing: the creator leaderboard from /api/leaderboard. Real rows only; when the service is down the demo flag says so. */
export function Standing() {
  const [sort, setSort] = useState<Sort>("views");
  const fn = useCallback(() => mk.leaderboard(sort), [sort]);
  const board = useAsync(fn);
  const top = board.status === "ready" ? Math.max(1, ...board.data.map((r) => (sort === "views" ? r.views : r.est))) : 1;

  return (
    <section className="section" aria-labelledby="standing">
      <div className="section-title">
        <h2 id="standing">Standing</h2>
        <div className="seg" role="group" aria-label="Rank creators by">
          <button aria-pressed={sort === "views"} onClick={() => setSort("views")}>Verified views</button>
          <button aria-pressed={sort === "earnings"} onClick={() => setSort("earnings")}>Est. USDC</button>
        </div>
      </div>
      <DemoNote label="Demo standing. The service did not answer, so these names and figures are sample data." />
      {board.status === "loading" && <Loading label="Counting views" rows={5} />}
      {board.status === "error" && <Correction what="Standing could not be tallied." fix="Nothing was changed. Try again." cause={board.error} onRetry={board.retry} />}
      {board.status === "ready" && board.data.length === 0 && <Empty title="No one is on the board yet.">Creators appear here after their first approved clip collects views.</Empty>}
      {board.status === "ready" && board.data.length > 0 && (
        <div className="ledger-wrap">
          <table className="ledger reflow standing">
            <caption className="micro">Ranked by {sort === "views" ? "verified views on approved clips" : "estimated earnings"}. Earnings are estimates before platform fees.</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Creator</th>
                <th scope="col" className="n">Verified views</th>
                <th scope="col" className="n">Approved clips</th>
                <th scope="col" className="n">Campaigns</th>
                <th scope="col" className="n">Est. USDC</th>
              </tr>
            </thead>
            <tbody>
              {board.data.map((c) => (
                <tr key={c.creatorId}>
                  <td className="lead-cell rank">{c.position}</td>
                  <td data-l="Creator">
                    <Byline name={c.handle} verified={c.verified} tier={c.tier} />
                    <span className="bar" aria-hidden="true"><i style={{ "--p": `${((sort === "views" ? c.views : c.est) / top) * 100}%` } as React.CSSProperties} /></span>
                  </td>
                  <td className="n" data-l="Verified views" title={whole(c.views)}>{compact(c.views)}</td>
                  <td className="n" data-l="Approved clips">{whole(c.approved)}</td>
                  <td className="n" data-l="Campaigns">{whole(c.campaigns)}</td>
                  <td className="n" data-l="Est. USDC">{money(c.est)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
