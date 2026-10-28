"use client";
import { useCallback, useState } from "react";
import { useAsync, useSession } from "./hooks";
import { actions, type WorldProof } from "./api";
import { Correction, Loading, PageHead } from "./Bits";
import { VerifiedMark } from "./Icons";
import { ChannelProof } from "./JoinView";
import { WorldCheck, worldFailText, type WorldResult } from "./WorldCheck";

function Channels() {
  const fn = useCallback(() => actions.channels(), []);
  const ch = useAsync(fn);
  const [adding, setAdding] = useState(false);
  return (
    <section className="stack" aria-labelledby="ch">
      <div className="section-title" style={{ marginBottom: 0 }}><h2 id="ch">Channels</h2></div>
      {ch.status === "loading" && <Loading rows={2} label="Reading your channels" />}
      {ch.status === "error" && <Correction what={ch.error} fix="Channels belong to creator accounts." onRetry={ch.retry} />}
      {ch.status === "ready" && (
        <ul>
          {ch.data.length === 0 && <li className="muted" style={{ padding: "12px 0" }}>No channels yet.</li>}
          {ch.data.map((c) => (
            <li key={c.id} className="row-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--rule-soft)" }}>
              <span><b>{c.handle}</b> <span className="micro">{c.platform.toLowerCase()}</span></span>
              <span className="micro" style={{ color: c.verified ? "var(--ok)" : "var(--hold)" }}>{c.verified ? "Proven" : "Code pending"}</span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="stack rise">
          <ChannelProof onDone={() => ch.retry()} />
          <button className="linkbtn" style={{ justifySelf: "start" }} onClick={() => setAdding(false)}>Done</button>
        </div>
      ) : <button className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setAdding(true)}>Add a channel</button>}
    </section>
  );
}

export function AccountView() {
  const s = useSession();
  const [world, setWorld] = useState(false);
  const [fail, setFail] = useState("");

  async function result(r: WorldResult, proof?: WorldProof, message?: string) {
    setWorld(false);
    if (r !== "verified" || !proof) return setFail(worldFailText(null, r, message));
    try {
      await s.verifyWorld(proof);
      setFail("");
    } catch (e) {
      setFail(worldFailText(e));
    }
  }

  return (
    <div className="wrap page">
      <PageHead kicker={<span>Account</span>} title={<>Who&rsquo;s <em>signing</em></>} />
      <div className="stack-lg" style={{ maxWidth: 820 }}>
        <section className="stack" aria-labelledby="id">
          <div className="section-title" style={{ marginBottom: 0 }}><h2 id="id">Identity</h2></div>
          <dl className="kv" style={{ maxWidth: 520 }}>
            <dt>Wallet</dt><dd>{s.address ?? "not connected"}</dd>
            <dt>Desk</dt><dd>{s.address ? s.role : "—"}</dd>
            <dt>Human check</dt><dd>{s.verified ? <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>verified <VerifiedMark size={14} /></span> : "not verified"}</dd>
          </dl>
          <div className="row">
            {s.address ? <button className="btn ghost sm" onClick={s.disconnect}>Disconnect</button> : <button className="btn sm" disabled={s.connecting} onClick={() => s.connect().catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect wallet"}</button>}
            {s.address && !s.verified && s.role === "creator" && <button className="btn sm" onClick={() => setWorld(true)}>Verify with World ID</button>}
          </div>
          {fail && <p className="notice warn" role="alert"><b>Not verified.</b>{fail}</p>}
        </section>

        {s.address && s.role === "creator" && <Channels />}

        <section className="stack" aria-labelledby="role">
          <div className="section-title" style={{ marginBottom: 0 }}><h2 id="role">Your desk</h2></div>
          <p className="muted">Each wallet holds one role, chosen the first time it signs in and fixed after that. To use another desk, switch accounts in your wallet and connect again. Admin rights come from the operator&rsquo;s allow-list, not from this page.</p>
          {s.notice && <p className="notice warn" role="status">{s.notice}</p>}
        </section>
      </div>
      {world && <WorldCheck kind="proof-of-human" purpose="Prove you are a unique human" onResult={result} />}
    </div>
  );
}
