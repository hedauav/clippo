"use client";
import { useState } from "react";
import Link from "next/link";
import { useSession } from "./hooks";
import { errText, extActions, type LinkPlatform, type WorldProof } from "./api";
import { PageHead } from "./Bits";
import { Arrow, Check, VerifiedMark } from "./Icons";
import { WorldCheck, worldFailText, type WorldResult } from "./WorldCheck";

type Ch = { id: string; handle: string; verificationCode: string };

export function ChannelProof({ onDone }: { onDone?: (handle: string) => void }) {
  const s = useSession();
  const [handle, setHandle] = useState("");
  const [ch, setCh] = useState<Ch | null>(null);
  const [tries, setTries] = useState(0);
  const [platform, setPlatform] = useState<Exclude<LinkPlatform, "other">>("youtube");
  const [state, setState] = useState<"idle" | "adding" | "checking" | "missing" | "found" | "review">("idle");
  const [err, setErr] = useState("");

  async function getCode() {
    setErr("");
    setState("adding");
    try {
      if (!s.user) await s.connect("creator");
      setCh(await extActions.channelAdd(platform, handle.trim()));
      setState("idle");
    } catch (e) {
      setErr(errText(e));
      setState("idle");
    }
  }

  async function check() {
    if (!ch) return;
    setState("checking");
    setErr("");
    try {
      const r = await extActions.channelVerify(ch.id, platform, tries);
      if (r.review) {
        setState("review");
        return;
      }
      setState("found");
      onDone?.(ch.handle);
    } catch (e) {
      setTries((n) => n + 1);
      setState("missing");
      setErr(errText(e));
    }
  }

  return (
    <div className="stack-lg">
      <div className="two">
        <div className="field">
          <label htmlFor="pl">Platform</label>
          <select id="pl" value={platform} onChange={(e) => { setPlatform(e.target.value as typeof platform); setCh(null); setState("idle"); setTries(0); }} aria-describedby="pl-h">
            <option value="youtube">YouTube</option>
            <option value="x">X</option>
            <option value="instagram">Instagram</option>
          </select>
          <span id="pl-h" className="hint">YouTube is read automatically. X and Instagram bios cannot always be read, so a person may confirm them.</span>
        </div>
        <div className="field">
          <label htmlFor="hd">Channel handle</label>
          <input id="hd" value={handle} onChange={(e) => { setHandle(e.target.value); setCh(null); setState("idle"); setTries(0); }} placeholder={platform === "youtube" ? "@yourchannel" : "@yourhandle"} autoComplete="off" />
        </div>
      </div>
      {!ch && (
        <button className="btn" style={{ justifySelf: "start" }} disabled={handle.trim().length < 3 || state === "adding"} onClick={getCode}>
          {state === "adding" ? "Issuing a code" : "Get my code"}
        </button>
      )}
      {err && state !== "missing" && <p className="notice warn" role="alert"><b>Could not continue.</b>{err}</p>}
      {ch && (
        <div className="stack rise">
          <span className="micro">Put this code in your {platform === "youtube" ? "channel description" : "profile bio"}</span>
          <div className="fig" style={{ fontSize: "clamp(1.2rem, 4vw, 2rem)", border: "2px dashed var(--ink)", padding: "14px 18px", background: "var(--paper-2)", width: "fit-content", maxWidth: "100%", overflowWrap: "anywhere", letterSpacing: "0.04em" }}>{ch.verificationCode}</div>
          <p className="muted">Leave it up until Clippo reads it. After that you can remove it.</p>
          <div className="row" style={{ gap: 20 }}>
            <button className="btn" onClick={check} disabled={state === "checking" || state === "found" || state === "review"}>{state === "checking" ? "Reading your profile" : state === "review" ? "Waiting for review" : "I put it there. Check."}</button>
            {state === "found" && <span className="row" role="status"><Check size={18} /> <b>Channel proven.</b></span>}
          </div>
          {state === "review" && <p className="notice warn" role="status"><b>Sent to a person.</b>Clippo cannot read {platform === "x" ? "X" : "Instagram"} bios automatically. A reviewer will look for the code, usually within a day. Leave it in your bio until then. You cannot submit clips from this account before they confirm.</p>}
          {state === "missing" && <p className="notice warn" role="alert"><b>Code not found yet.</b>{err} Platforms can take a minute to show the change. Check the spelling and try again.</p>}
        </div>
      )}
    </div>
  );
}

export function JoinView() {
  const s = useSession();
  const [role, setRole] = useState<"creator" | "campaigner" | null>(null);
  const [world, setWorld] = useState(false);
  const [fail, setFail] = useState("");
  const [channel, setChannel] = useState(false);

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
      <PageHead kicker={<span>Join</span>} title={<>Two desks. <em>Pick one.</em></>}>
        A wallet holds one role. To try the other desk, use another account in your wallet.
      </PageHead>

      {!role && (
        <div className="tickets" style={{ maxWidth: 820 }} role="radiogroup" aria-label="Pick a desk">
          <label className="ticket"><input type="radio" name="role" onChange={() => { setRole("creator"); s.pick("creator"); }} /><span className="ticket-body"><span className="idx">A</span><b>I clip</b><span className="d">Verify you are a person, prove a channel, pick a campaign.</span></span></label>
          <label className="ticket"><input type="radio" name="role" onChange={() => { setRole("campaigner"); s.pick("campaigner"); }} /><span className="ticket-body"><span className="idx">B</span><b>I pay for clips</b><span className="d">Connect a wallet, answer eight questions, fund a pool.</span></span></label>
        </div>
      )}

      {role === "campaigner" && (
        <section className="stack-lg" style={{ maxWidth: 640 }}>
          <h2 className="display h3">Connect the wallet that will hold the pool.</h2>
          {s.address && s.role === "campaigner" ? (
            <div className="stack"><p className="row" role="status"><Check size={18} /> Connected as <span className="fig">{s.address}</span></p><Link href="/desk/new" className="btn" style={{ justifySelf: "start" }}>Start a campaign <Arrow size={18} /></Link></div>
          ) : <button className="btn" style={{ justifySelf: "start" }} disabled={s.connecting} onClick={() => s.connect("campaigner").catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect wallet"}</button>}
          {fail && <p className="notice warn" role="alert"><b>Could not connect.</b>{fail}</p>}
        </section>
      )}

      {role === "creator" && (
        <ol className="stack-lg" style={{ maxWidth: 760 }}>
          <li className="stack">
            <span className="micro">Step 1 · One person, one account</span>
            <h2 className="display h3">Prove you are a human.</h2>
            {s.verified ? (
              <p className="row" role="status"><VerifiedMark size={18} /> <b>Verified with World ID.</b></p>
            ) : !s.address ? (
              <>
                <p className="muted">Connect your wallet first. Your account is tied to it, and so is the World ID check.</p>
                <button className="btn" style={{ justifySelf: "start" }} disabled={s.connecting} onClick={() => s.connect("creator").catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect wallet"}</button>
                {fail && <p className="notice warn" role="alert"><b>Could not connect.</b>{fail}</p>}
              </>
            ) : (
              <>
                <p className="muted">World ID checks you are a unique person without handing over who you are. Clippo only stores that you passed.</p>
                <button className="btn" style={{ justifySelf: "start" }} onClick={() => setWorld(true)}>Verify with World ID</button>
                {fail && <p className="notice warn" role="alert"><b>Not verified.</b>{fail}</p>}
              </>
            )}
          </li>
          <li className="stack" style={{ opacity: s.verified ? 1 : 0.4 }} inert={!s.verified}>
            <span className="micro">Step 2 · Prove a channel</span>
            <h2 className="display h3">Show it&rsquo;s yours.</h2>
            <ChannelProof onDone={() => setChannel(true)} />
          </li>
          {channel && (
            <li className="stack rise">
              <span className="micro">Done</span>
              <h2 className="display h3">You&rsquo;re on the wire.</h2>
              <Link href="/wire" className="btn" style={{ justifySelf: "start" }}>Find a campaign <Arrow size={18} /></Link>
            </li>
          )}
        </ol>
      )}
      {world && <WorldCheck kind="proof-of-human" purpose="Prove you are a unique human" onResult={result} />}
    </div>
  );
}
