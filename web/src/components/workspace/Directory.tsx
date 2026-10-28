"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useAsync } from "../hooks";
import { ws, errText } from "../api";
import { Correction, DemoNote, Empty, Loading, PageHead } from "../Bits";
import { TIER_LABEL, TIER_LIST, TIER_RULE, type DirCreator, type Tier } from "@/ui-mocks/workspace";
import { Ad, money, useSelection } from "./parts";
import { ShareBox } from "./ShareBox";

const TIERS: Tier[] = TIER_LIST;
const dir = () => ws.directory();

export function Directory() {
  const all = useAsync(dir);
  const sel = useSelection();
  const [fOpen, setFOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "">("");
  const [niche, setNiche] = useState("");
  const [plat, setPlat] = useState("");
  const [max, setMax] = useState("");

  const shown = useMemo(() => {
    if (all.status !== "ready") return [];
    const m = Number(max) || Infinity;
    const needle = q.trim().toLowerCase();
    return all.data.filter(
      (c: DirCreator) =>
        (!tier || c.tier === tier) &&
        (!niche || c.niches.includes(niche)) &&
        (!plat || c.platforms.includes(plat as DirCreator["platforms"][number])) &&
        (m === Infinity || c.lowest <= m) &&
        (!needle || `${c.name} ${c.niches.join(" ")} ${c.bio}`.toLowerCase().includes(needle)),
    );
  }, [all, q, tier, niche, plat, max]);

  const clear = () => {
    setQ("");
    setTier("");
    setNiche("");
    setPlat("");
    setMax("");
  };
  const niches = all.status === "ready" ? [...new Set(all.data.flatMap((c) => c.niches))].sort() : [];
  const picked = all.status === "ready" ? sel.ids.map((id) => all.data.find((c) => c.id === id)).filter((c): c is DirCreator => !!c) : [];
  const total = picked.reduce((a, c) => a + c.lowest, 0);

  return (
    <div className="wrap page">
      <PageHead kicker={<><span>Hire</span><span>Creator directory</span></>} title={<>Creators <em>for hire</em></>}>
        Pick the people you want instead of opening a bounty. Rates are set by the creators, in USDC. Tiers come from approved clips and pass rate, never follower counts.
      </PageHead>
      <DemoNote />

      <div className="cols" style={{ marginTop: 24 }}>
        <aside className="rail" aria-label="Filters and shortlist">
          <button type="button" className="btn sm ghost ws-fbtn" aria-expanded={fOpen} aria-controls="ws-filters" onClick={() => setFOpen((o) => !o)}>
            {fOpen ? "Hide filters" : "Filters"}
          </button>
          <form id="ws-filters" className="ws-filters" data-open={fOpen} role="search" onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <label htmlFor="q">Search</label>
              <input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Handle, niche, a word from the bio" />
            </div>
            <div className="field">
              <span className="lab" id="tier-l">Tier</span>
              <div className="ws-tiers" role="group" aria-labelledby="tier-l">
                {TIERS.map((t) => (
                  <button type="button" key={t} aria-pressed={tier === t} onClick={() => setTier(tier === t ? "" : t)}>
                    <b>{TIER_LABEL[t]}</b>
                    <span className="micro">{all.status === "ready" ? all.data.filter((c) => c.tier === t).length : 0}</span>
                    <small>{TIER_RULE[t]}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="niche">Niche</label>
              <select id="niche" value={niche} onChange={(e) => setNiche(e.target.value)}>
                <option value="">Any</option>
                {niches.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="plat">Platform</label>
              <select id="plat" value={plat} onChange={(e) => setPlat(e.target.value)}>
                <option value="">Any</option>
                <option value="youtube">YouTube</option>
                <option value="x">X</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="max">Cheapest rate, up to</label>
              <input id="max" inputMode="numeric" pattern="[0-9]*" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} placeholder="USDC, no cap" />
            </div>
            <button type="button" className="linkbtn" style={{ justifySelf: "start" }} onClick={clear}>Clear filters</button>
          </form>

          <section className="ws-tray" aria-labelledby="tray-h">
            <div className="row-between">
              <h2 id="tray-h" className="micro" style={{ color: "var(--ink)", fontWeight: 700 }}>Clipped, {picked.length}</h2>
              {picked.length > 0 && <span className="fig" style={{ fontSize: "0.8rem" }} aria-label={`Cheapest rates add up to ${money(total, 0)} USDC`}>${money(total, 0)}</span>}
            </div>
            {picked.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.875rem" }}>Nothing clipped yet. Use &ldquo;Clip this ad&rdquo; on a listing to start a shortlist.</p>
            ) : (
              <>
                <ol>
                  {picked.map((c) => (
                    <li key={c.id}>
                      <span>{c.name}</span>
                      <button onClick={() => sel.remove(c.id)} aria-label={`Remove ${c.name}`}>Drop</button>
                    </li>
                  ))}
                </ol>
                <div className="acts">
                  <Link href="/hire/brief" className="btn sm">Write the brief</Link>
                  <ShareBox ids={picked.map((c) => c.id)} />
                </div>
              </>
            )}
          </section>
        </aside>

        <section aria-labelledby="ads-h" aria-live="polite">
          <div className="section-title">
            <h2 id="ads-h">Listings</h2>
            <span className="micro">{all.status === "ready" ? `${shown.length} of ${all.data.length}` : ""}</span>
          </div>
          {all.status === "loading" && <Loading label="Setting the classifieds" rows={6} />}
          {all.status === "error" && <Correction what="The directory did not load." fix={errText(all.error)} onRetry={all.retry} />}
          {all.status === "ready" && shown.length === 0 && (
            <Empty title="No listing matches those filters." action={<button className="btn sm ghost" onClick={clear}>Clear filters</button>}>
              Loosen the rate cap or the tier. The directory lists only World ID verified creators with a proven channel.
            </Empty>
          )}
          {all.status === "ready" && shown.length > 0 && (
            <ul className="ws-ads">
              {shown.map((c) => <Ad key={c.id} c={c} clipped={sel.has(c.id)} onClip={() => sel.toggle(c.id)} />)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
