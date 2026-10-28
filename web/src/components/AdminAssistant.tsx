"use client";
import "./ext.css";
import { useState } from "react";
import { actions, extActions, errText } from "./api";
import { useAsync } from "./hooks";
import { Correction, Empty, Loading } from "./Bits";
import { whole } from "./format";

const REC = { overturn: "Overturn", uphold: "Uphold", review: "Needs your eyes" } as const;

/** Dispute summaries: appeal and flag cases boiled down, with a recommendation and the reason it is ranked where it is. */
export function Disputes() {
  const q = useAsync(extActions.disputes);
  const [done, setDone] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  async function decide(id: string, result: "APPROVE" | "REJECT", label: string) {
    setErr("");
    try {
      await actions.verdict(id, result, result === "APPROVE" ? "Appeal overturned by admin after reading the dispute summary." : "Rejection upheld by admin after reading the dispute summary.");
      setDone((d) => ({ ...d, [id]: label }));
    } catch (e) {
      setErr(errText(e));
    }
  }

  if (q.status === "loading") return <Loading label="Summarising disputes" rows={4} />;
  if (q.status === "error") return <Correction what={q.error} onRetry={q.retry} />;
  if (q.data.length === 0) return <Empty title="No open disputes.">Appeals and flagged clips will be summarised here.</Empty>;
  return (
    <div className="stack">
      {err && <p className="notice warn" role="alert"><b>Not recorded.</b>{err}</p>}
      <ol aria-live="polite">
        {[...q.data].sort((a, b) => a.rank - b.rank).map((d) => (
          <li className="x-case" key={d.id}>
            <span className="rk" aria-label={`Priority ${d.rank}`}>{d.rank}</span>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 10 }}><span className="tag solid">{d.appealNote ? "Appeal" : "Flagged"}</span><span className="micro">{d.creator}</span></div>
              <h2 style={{ fontFamily: "var(--f-display)", fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.1 }}>{d.title}</h2>
              <div className="x-vs">
                <div className="x-quote"><span className="micro">Agent verdict</span>{d.verdictReason}</div>
                {d.appealNote && <div className="x-quote" style={{ borderLeftColor: "var(--signal)" }}><span className="micro">Creator says</span>{d.appealNote}</div>}
              </div>
              <div className="note"><span className="micro">Assistant summary</span>{d.summary}</div>
              <p className="x-mono-line">Ranked {d.rank}: {d.rankWhy}</p>
            </div>
            <div className="stack act" style={{ alignContent: "start", justifyItems: "end" }}>
              <span className={`x-label ${d.recommend === "overturn" ? "ok" : d.recommend === "uphold" ? "no" : "hold"}`}>{REC[d.recommend]}</span>
              <span className="x-mono-line">CONF {d.confidence.toFixed(2)}</span>
              {done[d.id] ? <span className="micro" role="status">{done[d.id]}</span> : (
                <div className="row">
                  <button className={`btn sm${d.recommend === "overturn" ? "" : " ghost"}`} onClick={() => decide(d.id, "APPROVE", "Overturned")}>Overturn</button>
                  <button className={`btn sm${d.recommend === "uphold" ? "" : " ghost"}`} onClick={() => decide(d.id, "REJECT", "Upheld")}>Uphold</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Suspicious view growth: daily gains against a baseline for comparable clips. Holding pauses payout on that clip only. */
export function Growth() {
  const q = useAsync(extActions.growth);
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");

  async function toggle(id: string, next: boolean) {
    setErr("");
    try {
      await extActions.setHold(id, next);
      setHeld((h) => ({ ...h, [id]: next }));
    } catch (e) {
      setErr(errText(e));
    }
  }

  if (q.status === "loading") return <Loading label="Comparing growth curves" rows={4} />;
  if (q.status === "error") return <Correction what={q.error} onRetry={q.retry} />;
  if (q.data.length === 0) return <Empty title="Nothing unusual.">No clip is growing faster than comparable clips.</Empty>;
  return (
    <div className="stack">
      {err && <p className="notice warn" role="alert"><b>Not recorded.</b>{err}</p>}
      <ol>
        {q.data.map((a, i) => {
          const max = Math.max(...a.daily, a.baseline);
          const isHeld = held[a.id] ?? a.held;
          const peak = Math.max(...a.daily);
          return (
            <li className="x-case" key={a.id}>
              <span className="rk" aria-label={`Priority ${i + 1}`}>{i + 1}</span>
              <div className="stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 10 }}><span className="tag solid">View pattern</span><span className="micro">{a.creator} · {a.link}</span></div>
                <h2 style={{ fontFamily: "var(--f-display)", fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.1 }}>{a.campaign}</h2>
                <div className="x-bars" role="img" aria-label={`Views added per day: ${a.daily.map(whole).join(", ")}. Typical daily gain ${whole(a.baseline)}.`}>
                  {a.daily.map((v, k) => <i key={k} className={v > a.baseline * 5 ? "hot" : ""} style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />)}
                  <span className="base" style={{ bottom: `${(a.baseline / max) * 100}%` }} />
                </div>
                <div className="row-between x-mono-line"><span>day 1</span><span>dashed: typical {whole(a.baseline)} a day · peak {whole(peak)} ({Math.round(peak / a.baseline)}x)</span><span>day {a.daily.length}</span></div>
                <div className="note"><span className="micro">Assistant reading</span>{a.note}</div>
              </div>
              <div className="stack act" style={{ alignContent: "start", justifyItems: "end" }}>
                <span className={`x-label ${isHeld ? "hold" : ""}`}>{isHeld ? "Payout on hold" : "Not held"}</span>
                <button className="btn sm ghost" onClick={() => toggle(a.id, !isHeld)}>{isHeld ? "Release hold" : "Hold payout"}</button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
