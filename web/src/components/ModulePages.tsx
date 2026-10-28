"use client";
/* Optional modules. Each page asks its endpoint first. A disabled module answers 404 FEATURE_DISABLED, which `modules.*` turns into null,
   and the page then renders the framework 404: as far as a visitor can tell, the page does not exist. */
import { useCallback, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, errText, modules, type ChainProfile, type LadderInfo, type StatusMe } from "./api";
import { useAsync, useSession } from "./hooks";
import { Correction, Empty, Loading, PageHead, TickBar } from "./Bits";
import { compact, money, whole } from "./format";
import { TierMark, tierLabel } from "./Marks";
import type { TierName } from "@/ui-mocks/market";
import "./market.css";

function Gate({ error, retry, children }: { error: string; retry: () => void; children?: React.ReactNode }) {
  const s = useSession();
  return (
    <div className="wrap page">
      <div className="stack">
        <Correction what={error} fix={s.address ? undefined : "Connect a creator wallet to see this page."} onRetry={s.address ? retry : undefined} />
        {!s.address && <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => s.connect("creator").then(retry).catch(() => {})}>Connect as a creator</button>}
        {children}
      </div>
    </div>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/* ---------------- status ladder ---------------- */
const statusLoad = async () => {
  const ladder = await modules.ladder();
  if (!ladder) return null;
  const me = await modules.statusMe().catch(() => null);
  return { ladder, me };
};

function Rung({ i, t, state, me }: { i: number; t: LadderInfo["tiers"][number]; state: "done" | "now" | ""; me: StatusMe | null }) {
  const r = t.requirements;
  return (
    <li className="rung" data-s={state} aria-current={state === "now" ? "step" : undefined}>
      <span className="n">{i + 1}</span>
      <div className="stack" style={{ gap: 4 }}>
        <h3>{tierLabel(t.tier)} {state === "now" && <TierMark tier={t.tier as TierName} />}</h3>
        <span className="muted" style={{ fontSize: "0.9rem" }}>
          {r.approvedClips === 0 && r.verifiedViews === 0 ? "Verify as a human with World ID." : `${r.approvedClips} approved clips, ${pct(r.approveRate)} approve rate, ${compact(r.verifiedViews)} verified views.`}
        </span>
      </div>
      <span className="micro">{state === "done" ? "Held" : state === "now" ? "You are here" : me ? "Ahead" : ""}</span>
    </li>
  );
}

export function StatusView() {
  const d = useAsync(statusLoad);
  if (d.status === "loading") return <div className="wrap page"><Loading label="Reading the ladder" rows={5} /></div>;
  if (d.status === "error") return <Gate error={d.error} retry={d.retry} />;
  if (!d.data) notFound();
  const { ladder, me } = d.data;
  const idx = me?.tier ? ladder.tiers.findIndex((t) => t.tier === me.tier) : -1;
  const next = me?.nextRequirements;
  return (
    <div className="wrap page">
      <PageHead kicker={<><span>Status</span><span>Creator ladder</span></>} title={<>Climb on <em>approved work</em></>}>
        Tiers come from approved clips, approve rate and verified views. Followers are not counted. One fraud flag caps you at the first rung.
      </PageHead>
      <div className="cols flip">
        <section aria-labelledby="rungs">
          <div className="section-title"><h2 id="rungs">The rungs</h2></div>
          <ol className="rungs">
            {ladder.tiers.map((t, i) => <Rung key={t.tier} i={i} t={t} me={me} state={i < idx ? "done" : i === idx ? "now" : ""} />)}
          </ol>
        </section>
        <aside className="rail" aria-label="Your standing">
          {!me ? (
            <Empty title="Sign in to see your rung." action={<Link href="/ledger" className="btn sm">Go to the ledger</Link>}>The ladder is public. Your place on it is not.</Empty>
          ) : (
            <>
              <span className="micro">Your tier</span>
              <div className="fig-xl" style={{ fontSize: "2.4rem" }}>{me.tier ? tierLabel(me.tier) : "None yet"}</div>
              {!me.tier && <p className="muted">Verify with World ID to enter the first rung.</p>}
              <dl className="kv">
                <dt>Approved clips</dt><dd>{whole(me.metrics.approvedClips)}</dd>
                <dt>Approve rate</dt><dd>{pct(me.metrics.approveRate)}</dd>
                <dt>Verified views</dt><dd>{whole(me.metrics.verifiedViews)}</dd>
                <dt>Fraud flags</dt><dd>{me.metrics.fraudFlags}</dd>
              </dl>
              {me.nextTier && next ? (
                <div className="stack" style={{ gap: 12 }}>
                  <span className="micro">To reach {tierLabel(me.nextTier)}</span>
                  {([["Approved clips", me.metrics.approvedClips, next.approvedClips], ["Verified views", me.metrics.verifiedViews, next.verifiedViews]] as const).map(([l, have, need]) => (
                    <div key={l} className="stack" style={{ gap: 4 }}>
                      <div className="row-between"><span className="micro">{l}</span><span className="fig" style={{ fontSize: "0.8rem" }}>{compact(have)} / {compact(need)}</span></div>
                      <TickBar pct={need ? (have / need) * 100 : 100} label={`${l}: ${have} of ${need}`} />
                    </div>
                  ))}
                  <div className="row-between"><span className="micro">Approve rate</span><span className="fig" style={{ fontSize: "0.8rem" }}>{pct(me.metrics.approveRate)} / {pct(next.approveRate)}</span></div>
                </div>
              ) : me.tier ? (
                <p className="muted">Top rung. Nothing above it.</p>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------------- referrals ---------------- */
const refLoad = async () => {
  const sum = await modules.referral();
  if (!sum) return null;
  return { sum, camps: await api.campaigns() };
};

function CopyLine({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="copyline">
      <code>{text}</code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => setOk(true), () => setOk(false));
          setTimeout(() => setOk(false), 1800);
        }}
        aria-live="polite"
      >
        {ok ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ReferralView() {
  const d = useAsync(refLoad);
  const [made, setMade] = useState<{ code: string; campaignId: string }[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (d.status === "loading") return <div className="wrap page"><Loading label="Opening referrals" rows={4} /></div>;
  if (d.status === "error") return <Gate error={d.error} retry={d.retry} />;
  if (!d.data) notFound();
  const { sum, camps } = d.data;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const links = [...made, ...sum.links.filter((l) => !made.some((m) => m.code === l.code))];
  const title = (id: string) => camps.find((c) => c.id === id)?.title ?? "Campaign";
  const choice = pick || camps[0]?.id || "";

  async function create() {
    setBusy(true);
    setErr("");
    try {
      const l = await modules.referralLink(choice);
      setMade((m) => [l, ...m.filter((x) => x.code !== l.code)]);
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }

  return (
    <div className="wrap page">
      <PageHead kicker={<><span>Referrals</span><span>Creator</span></>} title={<>Bring a <em>person</em>, keep a cut</>}>
        Share a campaign link. When someone verified joins through it, you earn {(sum.config.cutBps / 100).toFixed(0)}% of their activity, up to ${money(sum.config.capUsdc, 0)}, with {sum.config.cooldownHours} hours between credits.
      </PageHead>
      {sum.frozen && <div className="notice warn" role="status" style={{ marginBottom: 28 }}><b>Referral credit is frozen on your account.</b>Links you already made stay up, but nothing new accrues until an admin lifts it.</div>}
      <div className="cols flip">
        <div className="stack-lg">
          <section className="stack" aria-labelledby="mk">
            <div className="section-title" style={{ marginBottom: 0 }}><h2 id="mk">Make a link</h2></div>
            {camps.length === 0 ? <Empty title="Nothing to refer to.">Links attach to a live campaign. None are open right now.</Empty> : (
              <div className="field">
                <label htmlFor="rc">Campaign</label>
                <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
                  <select id="rc" value={choice} onChange={(e) => setPick(e.target.value)} style={{ flex: 1 }}>
                    {camps.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                  <button className="btn sm" onClick={create} disabled={busy || sum.frozen}>{busy ? "Making" : "Make link"}</button>
                </div>
                {err && <span className="err" role="alert">{err}</span>}
              </div>
            )}
          </section>
          <section className="stack" aria-labelledby="ls">
            <div className="section-title" style={{ marginBottom: 0 }}><h2 id="ls">Your links</h2></div>
            {links.length === 0 ? <Empty title="No links yet.">Make one above, then post it where your audience is.</Empty> : (
              <ul className="stack">
                {links.map((l) => (
                  <li key={l.code} className="stack" style={{ gap: 6 }}>
                    <span className="micro">{title(l.campaignId)}</span>
                    <CopyLine text={`${origin}/slips/${l.campaignId}?ref=${l.code}`} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="rail" aria-label="Referral totals">
          <span className="micro">Credited so far</span>
          <div className="fig-xl">{money(sum.credited)}<span className="micro" style={{ marginLeft: 8 }}>USDC</span></div>
          <dl className="kv">
            <dt>People referred</dt><dd>{sum.referees}</dd>
            <dt>Room under the cap</dt><dd>{money(sum.remainingCap)}</dd>
            <dt>Cut</dt><dd>{(sum.config.cutBps / 100).toFixed(2)}%</dd>
          </dl>
          <TickBar pct={sum.config.capUsdc ? (sum.credited / sum.config.capUsdc) * 100 : 0} label="Share of the referral cap used" />
        </aside>
      </div>
    </div>
  );
}

/* ---------------- on-chain profile ---------------- */
const profLoad = () => modules.profile();
const TIER_NUM = ["None", "Verified", "Rising", "Partner", "Top"];

export function ChainProfileView() {
  const d = useAsync(profLoad);
  const [override, setOverride] = useState<ChainProfile["profile"] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toggle = useCallback(async (on: boolean) => {
    setBusy(true);
    setErr("");
    try {
      setOverride(await modules.profileOptIn(on));
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }, []);
  if (d.status === "loading") return <div className="wrap page"><Loading label="Reading your profile" rows={4} /></div>;
  if (d.status === "error") return <Gate error={d.error} retry={d.retry} />;
  if (!d.data) notFound();
  const profile = override === undefined ? d.data.profile : override;
  const p = d.data.preview;
  const on = !!profile?.optedIn;
  return (
    <div className="wrap page">
      <PageHead kicker={<><span>Profile</span><span>On-chain, non-transferable</span></>} title={<>Your record, <em>on the record</em></>}>
        An opt-in public profile of your approved clips, views and earnings, tied to your wallet. It cannot be sold or moved, and there is no token.
      </PageHead>
      <div className="cols flip">
        <section className="stack-lg" aria-labelledby="prev">
          <div className="section-title" style={{ marginBottom: 0 }}><h2 id="prev">What would be published</h2></div>
          <dl className="stats">
            <div><dt className="micro">Tier</dt><dd className="fig">{TIER_NUM[p.tier] ?? p.tier}</dd></div>
            <div><dt className="micro">Approved clips</dt><dd className="fig">{whole(p.approvedClips)}</dd></div>
            <div><dt className="micro">Rejected clips</dt><dd className="fig">{whole(p.rejectedClips)}</dd></div>
            <div><dt className="micro">Verified views</dt><dd className="fig">{compact(p.totalViews)}</dd></div>
            <div><dt className="micro">Earned, USDC</dt><dd className="fig">{money(p.totalEarnedUsdc / 1e6)}</dd></div>
          </dl>
          {profile?.syncedAt && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="micro">Last written {new Date(profile.syncedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              {profile.txHash && <span className="hash">tx {profile.txHash}</span>}
            </div>
          )}
        </section>
        <aside className="rail" aria-label="Opt in">
          <span className="micro">Status</span>
          <div className="fig-xl" style={{ fontSize: "2rem" }}>{on ? "Opted in" : "Off"}</div>
          <p className="muted" style={{ fontSize: "0.9rem" }}>{on ? "Your figures are written to your wallet's profile when they change. Opting out stops new writes; clearing what is already on-chain is a transaction from your wallet." : "Nothing is published unless you opt in. You can opt out at any time."}</p>
          <button className={on ? "btn ghost" : "btn"} disabled={busy} onClick={() => toggle(!on)}>{busy ? "Saving" : on ? "Opt out" : "Opt in"}</button>
          {err && <Correction what={err} />}
        </aside>
      </div>
    </div>
  );
}
