"use client";
import "./ext.css";
import { useCallback, useState } from "react";
import type { Submission } from "@/ui-mocks/data";
import type { AppealRec } from "@/ui-mocks/ext";
import { actions, errText, extActions } from "./api";
import { useAsync } from "./hooks";

type Step = "done" | "now" | "ok" | "no" | "";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Appeal states for one clip. Order is fixed by the backend: campaigner reviews first, the creator may escalate an upheld rejection, an admin decides last. */
export function AppealPanel({ s, onSent }: { s: Submission; onSent: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const hasAppeal = (s.appeal ?? "none") !== "none" || sent;
  const fn = useCallback(() => (hasAppeal ? extActions.appealFor(s.id) : Promise.resolve(null)), [hasAppeal, s.id]);
  const q = useAsync(fn);
  const rec: AppealRec | null = q.status === "ready" ? q.data : null;

  if (s.verdict === "needs_human") {
    return (
      <p className="x-risk" data-l="warn" style={{ display: "block" }} role="status">
        <span className="k">With a person </span>
        {s.platform === "youtube" ? "The agent was not sure." : "This platform cannot be read automatically."} A reviewer decides. Nothing for you to do.
      </p>
    );
  }
  if (s.verdict !== "rejected" && !(s.verdict === "approved" && s.appeal === "overturned")) return null;

  /* Resolve to one of: none | campaigner-open | campaigner-upheld | admin-open | overturned | admin-upheld */
  const simple = s.appeal === "overturned" ? "overturned" : s.appeal === "upheld" ? "admin-upheld" : s.appeal === "open" ? "campaigner-open" : "none";
  const state = rec
    ? rec.status === "OVERTURNED" ? "overturned"
      : rec.stage === "ADMIN" ? (rec.status === "OPEN" ? "admin-open" : "admin-upheld")
      : rec.status === "OPEN" ? "campaigner-open" : "campaigner-upheld"
    : sent && simple === "none" ? "campaigner-open" : simple;

  const steps: [string, string, Step][] = [
    ["01", "Campaigner reviews", state === "none" ? "" : state === "campaigner-open" ? "now" : state === "campaigner-upheld" ? "no" : "done"],
    ["02", "Admin reviews", state === "admin-open" ? "now" : state === "admin-upheld" ? "no" : state === "overturned" && rec?.stage === "ADMIN" ? "done" : ""],
    ["03", "Final", state === "overturned" ? "ok" : state === "admin-upheld" ? "no" : ""],
  ];

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await actions.appeal(s.id, txt.trim());
      setSent(true);
      onSent(s.id);
      setOpen(false);
      q.retry();
    } catch (er) {
      setErr(errText(er));
    }
    setBusy(false);
  }
  async function escalate() {
    if (!rec) return;
    setBusy(true);
    setErr("");
    try {
      await extActions.escalate(rec.id);
      q.retry();
    } catch (er) {
      setErr(errText(er));
    }
    setBusy(false);
  }

  const track = (
    <ol className="x-track" aria-label="Appeal progress">
      {steps.map(([n, l, st]) => (
        <li key={n} data-s={st}><span className="n">{n}</span><b>{l}</b></li>
      ))}
    </ol>
  );

  return (
    <div className="stack" style={{ gap: 10, marginTop: 6 }}>
      {state !== "none" || s.verdict === "rejected" ? track : null}
      {state === "none" && !open && (
        <p className="row" style={{ gap: 14 }}>
          <button className="linkbtn" onClick={() => setOpen(true)}>Appeal this verdict &rarr;</button>
          <span className="x-mono-line">Once per clip · the campaigner reads it first</span>
        </p>
      )}
      {state === "campaigner-open" && (
        <p className="note" role="status">
          <span className="micro">Waiting on the campaigner</span>
          {rec ? `Due ${when(rec.dueAt)}. ${rec.overdue ? "That has passed, so an admin may now take it over. " : "After that an admin may step in. "}` : ""}The clip stays rejected until someone decides.
        </p>
      )}
      {state === "campaigner-upheld" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="note" role="status"><span className="micro">Campaigner upheld the rejection</span>{rec?.resolution ?? "The rejection stands."} You can hand it to an admin for a final decision.</p>
          <button className="linkbtn" style={{ justifySelf: "start" }} onClick={escalate} disabled={busy}>{busy ? "Escalating" : "Escalate to an admin →"}</button>
        </div>
      )}
      {state === "admin-open" && <p className="note" role="status"><span className="micro">Waiting on admin</span>An admin makes the final decision. The clip stays rejected until then.</p>}
      {state === "overturned" && <p className="note" role="status"><span className="micro">Overturned</span>{rec?.resolution ?? "The rejection was reversed."} The clip now counts toward payout.</p>}
      {state === "admin-upheld" && <p className="note" role="status"><span className="micro">Upheld by admin</span>{rec?.resolution ?? "The rejection stands."} This is final.</p>}
      {open && (
        <form className="field rise" onSubmit={send}>
          <label htmlFor={`ap-${s.id}`}>Why is the verdict wrong?</label>
          <textarea id={`ap-${s.id}`} required minLength={10} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Point at the timestamp or the rule." />
          <span className="hint">One appeal per clip. The reviewer reads your note next to the agent&rsquo;s reason.</span>
          <div className="row">
            <button className="btn sm" disabled={busy || txt.trim().length < 10}>{busy ? "Sending" : "Send appeal"}</button>
            <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      {err && <span className="err" role="alert" style={{ color: "var(--no)", fontWeight: 700, fontSize: "0.875rem" }}>{err}</span>}
    </div>
  );
}
