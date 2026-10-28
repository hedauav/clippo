"use client";
import { useState } from "react";
import { ws, errText } from "../api";
import { Correction } from "../Bits";

/** Turns the clipped tray into a public, read-only shortlist link. */
export function ShareBox({ ids }: { ids: string[] }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState("");

  async function make() {
    setBusy(true);
    setErr("");
    try {
      const l = await ws.createList(title.trim() || "Shortlist", ids);
      setUrl(`${window.location.origin}/hire/lists/${l.token}`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (err) return <Correction what="The list link was not made." fix={err} onRetry={make} />;
  if (url)
    return (
      <div className="ws-share" role="status">
        <span className="micro">Public link, read only</span>
        <span className="url">{url}</span>
        <div className="copy-row">
          <button className="btn sm ghost" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
          <a className="linkbtn" href={url}>Open</a>
        </div>
      </div>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="field">
        <label htmlFor="lt">List name</label>
        <input id="lt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q4 finance explainers" maxLength={60} />
      </div>
      <button className="btn sm ghost" onClick={make} disabled={busy}>{busy ? "Setting type" : "Make shareable link"}</button>
    </div>
  );
}
