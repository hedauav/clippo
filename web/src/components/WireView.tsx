"use client";
import { useMemo, useState } from "react";
import { mk } from "@/components/api";
import { useAsync } from "./hooks";
import { Correction, DemoNote, Empty, Loading, PageHead, Slip } from "./Bits";
import { compact } from "./format";
import { VerifiedMark } from "./Icons";
import { Standing } from "./Standing";
import "./market.css";
import type { PayMode, Platform } from "@/ui-mocks/data";

const trendingNow = () => mk.trending(7);
const SORTS = { trending: "Trending", rate: "Highest rate", left: "Most left" } as const;

export function WireView() {
  const camps = useAsync(trendingNow);
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [mode, setMode] = useState<PayMode | "all">("all");
  const [sort, setSort] = useState<keyof typeof SORTS>("trending");

  const list = useMemo(() => {
    if (camps.status !== "ready") return [];
    const l = camps.data.filter((t) => (platform === "all" || t.campaign.platforms.includes(platform)) && (mode === "all" || t.campaign.mode === mode));
    /* "trending" keeps the server order (trend score). The other sorts are plain field sorts. */
    return [...l].sort((a, b) =>
      sort === "rate" ? b.campaign.rate - a.campaign.rate : sort === "left" ? b.campaign.pool - b.campaign.paid - (a.campaign.pool - a.campaign.paid) : a.position - b.position,
    );
  }, [camps, platform, mode, sort]);

  return (
    <div className="wrap page">
      <PageHead kicker={<><span>The Wire</span><span>Open campaigns</span><DemoNote /></>} title={<>Campaigns paying <em>right now</em></>}>
        Every slip is a funded USDC pool that an admin has signed. Pick one you can say true things about.
      </PageHead>

      <div className="row-between" style={{ marginBottom: 24 }}>
        <div className="row" role="group" aria-label="Filter by platform">
          <div className="seg">
            {(["all", "youtube", "x", "instagram"] as const).map((p) => (
              <button key={p} aria-pressed={platform === p} onClick={() => setPlatform(p)}>
                {p === "all" ? "All platforms" : p === "x" ? "X" : p}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Filter by payout rule">
            {([["all", "Any rule"], ["per_view", "Per view"], ["human_split", "Split"], ["pool_share", "Pool share"]] as const).map(([k, l]) => (
              <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className="row micro" style={{ gap: 8 }}>
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}
            style={{ background: "transparent", border: "1px solid var(--rule)", padding: "8px 10px", minHeight: 40, fontFamily: "var(--f-mono)", fontSize: "0.72rem" }}
          >
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div aria-live="polite">
        {camps.status === "loading" && <Loading label="Setting the wire" rows={5} />}
        {camps.status === "error" && <Correction what="The wire did not come back." fix="Your campaigns are safe. Nothing was changed." cause={camps.error} onRetry={camps.retry} />}
        {camps.status === "ready" && list.length === 0 && (
          <Empty
            title="Nothing on the wire matches that."
            clip={2}
            action={
              <button className="linkbtn" onClick={() => { setPlatform("all"); setMode("all"); }}>
                Clear filters
              </button>
            }
          >
            Try another platform or payout rule.
          </Empty>
        )}
        {camps.status === "ready" && list.length > 0 && (
          <div className="slips">
            {list.map((t) => (
              <div className="slip-wrap" key={t.campaign.id}>
                <Slip c={t.campaign} />
                <p className="heat" style={{ padding: "6px 2px 0" }}>
                  {sort === "trending" && <span className="micro">#{t.position}</span>}
                  {t.viewsGained > 0 ? <><b>+{compact(t.viewsGained)}</b> views in {t.windowDays} days</> : <>No new views in {t.windowDays} days</>}
                  {t.verified && <VerifiedMark size={13} />}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Standing />
    </div>
  );
}
