"use client";
import "./ext.css";
import { useCallback, useState } from "react";
import Link from "next/link";
import type { Campaign } from "@/ui-mocks/data";
import type { BriefExplain, Risk } from "@/ui-mocks/ext";
import { detectPlatform, extActions, errText } from "./api";
import { useAsync } from "./hooks";
import { Correction, Loading } from "./Bits";
import { PLATFORM_LABEL } from "./format";

/** Honest status line under the link box: what Clippo can read for this platform, and what happens if it cannot. */
export function LinkReadiness({ url, allowed }: { url: string; allowed: Campaign["platforms"] }) {
  if (!url.trim()) return null;
  const p = detectPlatform(url);
  if (p === "other") return <p className="x-risk" data-l="block" role="alert" style={{ display: "block" }}><span className="k">Cannot submit </span>This is not a YouTube, X or Instagram link.</p>;
  const notAllowed = !allowed.includes(p);
  return (
    <div className="stack" style={{ gap: 6 }} aria-live="polite">
      {notAllowed && (
        <p className="x-risk" data-l="block" style={{ display: "block" }}><span className="k">Wrong platform </span>This campaign pays for {allowed.map((a) => PLATFORM_LABEL[a]).join(" or ")} posts. A {PLATFORM_LABEL[p]} link will be rejected.</p>
      )}
      {p === "youtube" ? (
        <p className="x-mono-line">YouTube: transcript and views are read automatically. Verdict in under a minute.</p>
      ) : (
        <p className="x-risk" data-l="warn" style={{ display: "block" }}>
          <span className="k">Human review </span>
          {PLATFORM_LABEL[p]} posts cannot be read automatically. This one goes to a person, not the agent, and cannot be approved instantly. Expect up to a day.
        </p>
      )}
    </div>
  );
}

const TABS = [["explain", "Explain the brief"], ["check", "Check before posting"], ["match", "Campaigns that fit"]] as const;
type Tab = (typeof TABS)[number][0];

function Explain({ c }: { c: Campaign }) {
  const fn = useCallback(() => extActions.explainBrief(c.id, { story: c.story, mustSay: c.mustSay, mustNot: c.mustNot, disclosure: c.disclosure }), [c]);
  const r = useAsync<BriefExplain>(fn);
  if (r.status === "loading") return <Loading label="Reading the brief" rows={3} />;
  if (r.status === "error") return <Correction what="The brief could not be explained." cause={r.error} onRetry={r.retry} />;
  return (
    <div className="stack rise">
      <p className="prose">{r.data.plain}</p>
      <div className="two" style={{ gap: 24 }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="micro">Do</span>
          <ul className="x-list">{r.data.doList.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="micro">Avoid</span>
          <ul className="x-list">{r.data.avoidList.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      </div>
      <p><span className="micro">Label </span>{r.data.label}</p>
    </div>
  );
}

function Check({ c, link }: { c: Campaign; link: string }) {
  const [caption, setCaption] = useState("");
  const [risks, setRisks] = useState<Risk[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true);
    setErr("");
    try {
      setRisks(await extActions.riskCheck(c.id, { link, caption }, { mustSay: c.mustSay, mustNot: c.mustNot, disclosure: c.disclosure }));
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  const KIND = { block: "Likely reject", warn: "Check", note: "Note" } as const;
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="cap">Caption and description you plan to post</label>
        <textarea id="cap" value={caption} onChange={(e) => { setCaption(e.target.value); setRisks(null); }} style={{ minHeight: 96 }} />
        <span className="hint">{link ? "The link in the box above is checked too." : "Paste the link above to include it."} Nothing is submitted.</span>
      </div>
      <button type="button" className="btn sm" style={{ justifySelf: "start" }} disabled={busy || (!caption.trim() && !link.trim())} onClick={run}>{busy ? "Reading" : "Check for rejection risk"}</button>
      {err && <p className="notice warn" role="alert"><b>Could not check.</b>{err}</p>}
      {risks && (
        <div aria-live="polite" className="rise">
          {risks.map((r, i) => (
            <div className="x-risk" data-l={r.level} key={i}><span className="k">{KIND[r.level]}</span><span>{r.text}</span><span className="r">{r.rule}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function Matches({ id }: { id: string }) {
  const r = useAsync(extActions.matches);
  if (r.status === "loading") return <Loading label="Matching" rows={3} />;
  if (r.status === "error") return <Correction what="Matches did not load." cause={r.error} onRetry={r.retry} />;
  const rows = r.data.filter((m) => m.campaignId !== id || r.data.length < 2);
  return (
    <div>
      {rows.map((m, i) => (
        <div className="x-match" key={i}>
          <span className="fit" aria-label={`Fit ${Math.round(m.fit * 100)} percent`}>{Math.round(m.fit * 100)}</span>
          <Link className="t" href={`/slips/${m.campaignId}`}>{m.title}</Link>
          <span className="x-mono-line">{m.platform} · {m.pays}</span>
          <span className="note" style={{ fontSize: "0.875rem" }}><span className="micro">Why</span>{m.why}</span>
        </div>
      ))}
    </div>
  );
}

export function CreatorAssistant({ c, link }: { c: Campaign; link: string }) {
  const [tab, setTab] = useState<Tab>("explain");
  return (
    <section className="x-box" aria-labelledby="ca-h">
      <div className="x-cap" style={{ borderTop: 0, paddingTop: 0 }}>
        <h3 id="ca-h" className="x-head">Desk assistant</h3>
        <span className="micro">Advice. It does not decide verdicts.</span>
      </div>
      <div className="seg" role="tablist" aria-label="Assistant tools">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div role="tabpanel">
        {tab === "explain" && <Explain c={c} />}
        {tab === "check" && <Check c={c} link={link} />}
        {tab === "match" && <Matches id={c.id} />}
      </div>
    </section>
  );
}
