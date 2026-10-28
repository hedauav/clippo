"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, detectPlatform, errText, extActions, mk } from "./api";
import type { Campaign, Submission } from "@/ui-mocks/data";
import { useAsync, useSession } from "./hooks";
import { Correction, DemoNote, Empty, Loading, TickBar } from "./Bits";
import { MODE_LABEL, PLATFORM_LABEL, compact, money, whole } from "./format";
import { Link as LinkIcon, Upload } from "./Icons";
import { Stamp } from "./Stamp";
import { AppealPanel } from "./AppealPanel";
import { CreatorAssistant, LinkReadiness } from "./CreatorAssistant";
import { DealPanel } from "./DealPanel";

function ViewsChart({ daily }: { daily: number[] }) {
  if (daily.length < 2) return <p className="note"><span className="micro">Daily history</span>The chart fills in once the first daily view snapshots are saved.</p>;
  const W = 640, H = 200, P = 28;
  const max = Math.max(...daily) * 1.05;
  const x = (i: number) => P + (i * (W - P * 2)) / (daily.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const pts = daily.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = daily.length - 1;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumulative verified views over ${daily.length} days, ending at ${whole(daily[last])}`}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line className="ax" x1={P} x2={W - P} y1={y(max * t)} y2={y(max * t)} />
          <text x={P - 4} y={y(max * t) + 3} textAnchor="end">{compact(Math.round(max * t))}</text>
        </g>
      ))}
      <polyline className="ln" points={pts} />
      <circle className="dot" cx={x(last)} cy={y(daily[last])} r="5" />
      <text x={P} y={H - 6}>day 1</text>
      <text x={W - P} y={H - 6} textAnchor="end">day {daily.length}</text>
    </svg>
  );
}

/** Daily views from GET /campaigns/:id/views, drawn as a cumulative line. Says so plainly when the feed is missing or empty. */
function DailyViews({ id }: { id: string }) {
  const fn = useCallback(() => mk.daily(id), [id]);
  const q = useAsync(fn);
  if (q.status === "loading") return <Loading label="Pulling daily views" rows={2} />;
  if (q.status === "error") return <Correction what={q.error} onRetry={q.retry} />;
  const cumulative = q.data.reduce<number[]>((acc, d) => [...acc, (acc[acc.length - 1] ?? 0) + d.views], []);
  return <ViewsChart daily={cumulative} />;
}

const REF_KEY = (id: string) => `clippo-ref-${id}`;
/** ?ref=<code> on a slip link: remember it for this campaign (it must survive connecting a wallet and verifying) until the visitor joins. */
function useReferral(campaignId: string) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      let found = new URLSearchParams(window.location.search).get("ref");
      try {
        if (found) sessionStorage.setItem(REF_KEY(campaignId), found);
        else found = sessionStorage.getItem(REF_KEY(campaignId));
      } catch {
        /* storage blocked: the code only lives for this page view */
      }
      setCode(found && /^[\w-]{3,64}$/.test(found) ? found : null);
    }, 0);
    return () => clearTimeout(t);
  }, [campaignId]);
  return code;
}

function SubmissionRow({ s, onAppeal }: { s: Submission; onAppeal: (id: string) => void }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "6px 24px", padding: "18px 0", borderBottom: "1px solid var(--rule-soft)" }}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="micro">{PLATFORM_LABEL[s.platform]} · {s.at}</span>
          {s.appeal === "open" && <span className="tag solid">Appeal open</span>}
        </div>
        <a href={s.url} className="handle" style={{ fontWeight: 700 }} target="_blank" rel="noreferrer noopener">{s.title}</a>
        <div className="note">
          <span className="micro">Agent note</span>
          {s.reason}
        </div>
        <AppealPanel s={s} onSent={onAppeal} />
      </div>
      <div className="stack" style={{ justifyItems: "end", alignContent: "start" }}>
        <Stamp verdict={s.verdict} conf={s.confidence || undefined} />
        <div className="fig" style={{ fontSize: "0.875rem", marginTop: 6 }}>{s.views ? `${whole(s.views)} views` : "no views yet"}</div>
        <div className="fig" style={{ fontSize: "0.875rem", color: s.earned ? "var(--ink)" : "var(--ink-3)" }}>{s.earned ? `${money(s.earned)} USDC` : "unpaid"}</div>
      </div>
    </li>
  );
}

const joinReason = (r: { reasons: string[]; requiredTier: string | null; creatorTier: string | null }) =>
  r.reasons.includes("NOT_HIRED")
    ? "This campaign is limited to creators the campaigner hired."
    : r.reasons.includes("NOT_VERIFIED")
      ? "Verify with World ID first."
      : r.requiredTier
        ? `This campaign needs ${r.requiredTier.toLowerCase()} tier or better. You are ${(r.creatorTier ?? "new").toLowerCase()}.`
        : "You can't join this one right now.";

function Detail({ c }: { c: Campaign }) {
  const s = useSession();
  const subsFn = useCallback(() => api.campaignSubmissions(c.id), [c.id]);
  const subs = useAsync(subsFn);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [noJoin, setNoJoin] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Submission[]>([]);
  const [appealed, setAppealed] = useState<string[]>([]);
  const ref = useReferral(c.id);
  const [refNote, setRefNote] = useState("");

  const pct = (c.paid / c.pool) * 100;
  const needsVerify = s.ready && !s.verified;
  const badLink = !!url && detectPlatform(url) === "other";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const sub = await extActions.submitLink(c.id, url.trim());
      setLocal((l) => [sub, ...l]);
      setUrl("");
    } catch (er) {
      setErr(errText(er));
    }
    setBusy(false);
  }

  async function join() {
    setJoining(true);
    setNoJoin("");
    try {
      const r = await mk.join(c.id, ref);
      if (r.eligible) setJoined(true);
      else setNoJoin(joinReason(r));
      if (r.referral === "attributed") setRefNote("Referral recorded: the creator who sent you earns a cut of your activity.");
      else if (r.referral === "already") setRefNote("You were already referred by someone else, so this link was not counted. The first referral wins.");
      else if (r.referral === "refused") setRefNote("This referral link could not be counted (for example, it is your own).");
    } catch (e) {
      setNoJoin(errText(e));
    }
    setJoining(false);
  }

  const closed = c.status === "closed" || c.status === "rejected";
  const all = [...local, ...(subs.status === "ready" ? subs.data : [])].map((x) => (appealed.includes(x.id) ? { ...x, appeal: "open" as const } : x));

  return (
    <div className="wrap page">
      <header className="page-head">
        <div className="micro">
          <Link href="/wire">The Wire</Link>
          <span>No. {c.serial}</span>
          <span>{MODE_LABEL[c.mode]}</span>
          <DemoNote />
        </div>
        <h1 className="display" style={{ fontSize: "clamp(2.2rem, 5.2vw, 4.6rem)" }}>{c.title}</h1>
        <p className="lead">{c.pitch}</p>
      </header>

      <div className="cols">
        <aside className="rail" aria-label="The brief">
          <div className="stack">
            <span className="micro">Rate</span>
            {c.mode === "per_view" ? (
              <div className="fig-xl signal">${money(c.rate)}<span className="micro" style={{ marginLeft: 8 }}>per 1K</span></div>
            ) : (
              <div className="fig-xl signal">${money(c.pool, 0)}</div>
            )}
          </div>
          <dl className="kv">
            <dt>Pool</dt><dd>${money(c.pool, 0)}</dd>
            <dt>Allocated</dt><dd>${money(c.paid, 0)}</dd>
            <dt>Left</dt><dd>${money(c.pool - c.paid, 0)}</dd>
            <dt>Closes</dt><dd>{c.closesIn || "when closed"}</dd>
            <dt>Post on</dt><dd>{c.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}</dd>
            <dt>Who</dt><dd>{c.access === "anyone" ? "Any verified" : "Ranked only"}</dd>
          </dl>
          {c.hasSource && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="micro">Source material</span>
              <a className="btn ghost sm" href={c.contentUrl ?? "#"} download target="_blank" rel="noreferrer noopener"><Upload size={16} /> Download source</a>
            </div>
          )}
        </aside>

        <div className="stack-lg">
          <section aria-labelledby="perf" className="stack">
            <div className="section-title" style={{ marginBottom: 0 }}>
              <h2 id="perf">Performance</h2>
              <span className="fig">{whole(c.views)} verified views</span>
            </div>
            <DailyViews id={c.id} />
            <div className="stack" style={{ gap: 6 }}>
              <div className="row-between"><span className="micro">Payout progress</span><span className="fig" style={{ fontSize: "0.875rem" }}>{Math.round(pct)}% of pool allocated</span></div>
              <TickBar pct={pct} big sig label={`${Math.round(pct)} percent of pool allocated`} />
            </div>
            <div className="row" style={{ gap: 32 }}>
              <div><span className="micro">Creators</span><div className="fig" style={{ fontSize: "1.4rem" }}>{c.creators}</div></div>
              <div><span className="micro">Clips</span><div className="fig" style={{ fontSize: "1.4rem" }}>{c.clips}</div></div>
            </div>
          </section>

          <section aria-labelledby="brief" className="stack">
            <div className="section-title" style={{ marginBottom: 0 }}><h2 id="brief">The brief</h2></div>
            <p className="prose">{c.story}</p>
            <div className="two">
              <div className="stack" style={{ gap: 8 }}>
                <span className="micro">Must say</span>
                <ul className="stack" style={{ gap: 6 }}>{c.mustSay.map((m) => <li key={m} style={{ borderLeft: "3px solid var(--ok)", paddingLeft: 10 }}>{m}</li>)}</ul>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <span className="micro">Must not say</span>
                <ul className="stack" style={{ gap: 6 }}>{c.mustNot.map((m) => <li key={m} style={{ borderLeft: "3px solid var(--no)", paddingLeft: 10 }}>{m}</li>)}</ul>
              </div>
            </div>
            <p><span className="micro">Disclosure </span>{c.disclosure}</p>
          </section>

          <section aria-labelledby="mine" className="stack">
            <div className="section-title" style={{ marginBottom: 0 }}><h2 id="mine">Your clips</h2></div>
            {closed ? (
              <Empty title="Closed to new clips.">This campaign is no longer taking submissions.</Empty>
            ) : !s.address ? (
              <Empty title="Connect a wallet to join." action={<button className="btn sm" disabled={s.connecting} onClick={() => s.connect("creator").catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect wallet"}</button>}>{noJoin && <span role="alert" style={{ color: "var(--no)", fontWeight: 700 }}>{noJoin} </span>}Joining and claiming use your own address.{ref ? " You arrived through a referral link." : ""}</Empty>
            ) : needsVerify ? (
              <Empty title="Verify you are a person first." action={<Link href="/join" className="btn sm">Verify with World ID</Link>}>One person, one account. It takes under a minute.</Empty>
            ) : !joined && all.length === 0 ? (
              <Empty title="Not joined yet." action={<button className="btn" onClick={join} disabled={joining}>{joining ? "Checking" : "Join this campaign"}</button>}>
                {noJoin && <span className="err" role="alert" style={{ color: "var(--no)", fontWeight: 700 }}>{noJoin} </span>}
                Joining is free. Post on {c.platforms.map((p) => PLATFORM_LABEL[p]).join(" or ")} from a channel you have proven, then paste the link here.
              </Empty>
            ) : (
              <>
                {refNote && <p className="notice" role="status">{refNote}</p>}
                <form className="stack" onSubmit={submit} noValidate>
                  <div className={`field${err ? " bad" : ""}`}>
                    <label htmlFor="url">Clip link</label>
                    <div className="row" style={{ alignItems: "flex-end" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <input id="url" inputMode="url" placeholder="https://youtube.com/shorts/… or x.com/… or instagram.com/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-describedby="url-h" aria-invalid={!!err} />
                      </div>
                      <button className="btn sm" disabled={busy || !url || badLink}><LinkIcon size={16} /> {busy ? "Sending" : "Submit"}</button>
                    </div>
                    <span id="url-h" className="hint">Before you submit: say the required points out loud, show the label in the first 5 seconds, avoid every prohibited claim.</span>
                    {err && <span className="err" role="alert">{err}</span>}
                    <LinkReadiness url={url} allowed={c.platforms} />
                  </div>
                </form>
                {subs.status === "loading" && <Loading label="Pulling your clips" rows={3} />}
                {subs.status === "error" && <Correction what="Your clips did not load." cause={subs.error} onRetry={subs.retry} />}
                {subs.status === "ready" && all.length === 0 && <Empty title="No clips yet.">Paste a link above. The verdict lands here with its reason.</Empty>}
                {all.length > 0 && <ul aria-live="polite">{all.map((x) => <SubmissionRow key={x.id} s={x} onAppeal={(id) => setAppealed((a) => [...a, id])} />)}</ul>}
              </>
            )}
          </section>

          {!closed && s.address && s.role === "creator" && <CreatorAssistant c={c} link={url} />}
          {!closed && <DealPanel c={c} />}
        </div>
      </div>
    </div>
  );
}

export function SlipDetail() {
  const { id } = useParams<{ id: string }>();
  const fn = useCallback(() => api.campaign(id), [id]);
  const c = useAsync(fn);
  if (c.status === "loading") return <div className="wrap page"><Loading label="Pulling the slip" rows={6} /></div>;
  if (c.status === "error") return <div className="wrap page"><Correction what="That campaign could not be loaded." cause={c.error} onRetry={c.retry} /></div>;
  if (!c.data)
    return (
      <div className="wrap page">
        <Empty title="No such slip." action={<Link href="/wire" className="btn sm">Back to the wire</Link>}>It may have closed, or the link is wrong.</Empty>
      </div>
    );
  return <Detail c={c.data} />;
}
