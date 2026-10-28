"use client";
import "./ext.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiJob, SourceFile } from "@/ui-mocks/ext";
import { extActions, errText, MAX_UPLOAD, uploadSource } from "./api";
import { TickBar, DemoNote } from "./Bits";
import { Upload } from "./Icons";

export type SourceState = { file: SourceFile | null; job: AiJob | null; rights: boolean };
export const EMPTY_SOURCE: SourceState = { file: null, job: null, rights: false };

export type SourceKind = "upload" | "link" | "generate";
export function sourceReady(kind: SourceKind | "", detail: string, s: SourceState) {
  if (kind === "upload") return !!s.file;
  if (kind === "link") return /^https?:\/\/\S+\.\S+/.test(detail.trim());
  if (kind === "generate") return s.job?.status === "approved";
  return false;
}
export function sourceUrl(kind: SourceKind | "", detail: string, s: SourceState): string | undefined {
  if (kind === "upload") return s.file?.url;
  if (kind === "link") return detail.trim();
  if (kind === "generate") return s.job?.videoUrl ?? undefined;
}

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function UploadPart({ s, set }: { s: SourceState; set: (p: Partial<SourceState>) => void }) {
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  async function take(f: File | undefined) {
    if (!f) return;
    setErr("");
    if (!f.type.startsWith("video/")) return setErr(`${f.name} is not a video. Use MP4, MOV or WebM.`);
    if (f.size > MAX_UPLOAD) return setErr(`${f.name} is ${size(f.size)}. The limit is ${size(MAX_UPLOAD)}.`);
    ctl.current = new AbortController();
    setBusy(f);
    setPct(0);
    try {
      const file = await uploadSource(f, setPct, ctl.current.signal);
      set({ file });
    } catch (e) {
      if (!(e instanceof DOMException)) setErr(errText(e, "The upload failed. Nothing was saved."));
    }
    setBusy(null);
  }

  if (s.file) {
    return (
      <div className="x-player rise">
        <video controls preload="metadata" src={s.file.url} aria-label={`Preview of ${s.file.name}`} />
        <div className="row-between">
          <span className="x-mono-line">{s.file.name} · {size(s.file.size)}</span>
          <span className="row" style={{ gap: 18 }}>
            <a className="linkbtn" href={s.file.url} download={s.file.name}>Download</a>
            <button type="button" className="linkbtn" onClick={() => set({ file: null })}>Replace</button>
          </span>
        </div>
        {s.file.local && <p className="notice warn" role="note"><b>Held in this browser only.</b>The upload service did not answer, so creators cannot reach this file yet.</p>}
      </div>
    );
  }

  return (
    <div className="stack">
      {!busy ? (
        <label className="x-drop" data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}>
          <input type="file" accept="video/*" aria-label="Video file" onChange={(e) => take(e.target.files?.[0])} />
          <span className="row" style={{ gap: 10 }}><Upload size={20} /><b>Drop the original here</b></span>
          <span className="x-mono-line">or choose a file · MP4, MOV, WebM · up to {size(MAX_UPLOAD)}</span>
        </label>
      ) : (
        <div className="x-prog" role="status" aria-live="polite">
          <div className="row-between"><span className="x-mono-line">{busy.name}</span><span className="fig">{pct}%</span></div>
          <TickBar pct={pct} big sig label={`Upload ${pct} percent`} />
          <div className="row-between"><span className="x-mono-line">{size((busy.size * pct) / 100)} of {size(busy.size)}</span><button type="button" className="linkbtn" onClick={() => ctl.current?.abort()}>Cancel</button></div>
        </div>
      )}
      {err && <p className="notice warn" role="alert"><b>Not uploaded.</b>{err}</p>}
    </div>
  );
}

const STEPS: [AiJob["status"], string][] = [["queued", "Queued"], ["rendering", "Rendering"], ["ready", "Ready"], ["approved", "Approved"]];

function GeneratePart({ prompt, setPrompt, s, set }: { prompt: string; setPrompt: (v: string) => void; s: SourceState; set: (p: Partial<SourceState>) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const job = s.job;
  const live = job && (job.status === "queued" || job.status === "rendering");

  useEffect(() => {
    if (!job || !live) return;
    const t = setInterval(() => {
      extActions.aiStatus(job.id).then((j) => set({ job: j })).catch((e) => setErr(errText(e)));
    }, 1500);
    return () => clearInterval(t);
  }, [job, live, set]);

  async function make() {
    setErr("");
    setBusy(true);
    try {
      set({ job: await extActions.aiCreate(prompt.trim(), s.rights) });
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  async function approve() {
    if (!job) return;
    setErr("");
    setBusy(true);
    try {
      set({ job: await extActions.aiApprove(job.id) });
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }

  if (!job || job.status === "failed") {
    return (
      <div className="stack">
        <div className="field">
          <label htmlFor="gd">Describe the video</label>
          <textarea id="gd" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A finance lead closes the month on a laptop at 9:04, the clock reads 9:07." />
          <span className="hint">Shots, setting, tone. Do not name real people or brands you do not own.</span>
        </div>
        <label className="x-check">
          <input type="checkbox" checked={s.rights} onChange={(e) => set({ rights: e.target.checked })} />
          <span>I confirm I hold the rights to everything described here, and that creators may cut and repost the result. It will carry an AI-GENERATED label.</span>
        </label>
        {job?.status === "failed" && <p className="notice warn" role="alert"><b>Generation failed.</b>{job.error ?? "The renderer stopped before finishing. Nothing was charged."}</p>}
        {err && <p className="notice warn" role="alert"><b>Stopped.</b>{err}</p>}
        <button type="button" className="btn" style={{ justifySelf: "start" }} disabled={prompt.trim().length < 20 || !s.rights || busy} onClick={make}>
          {busy ? "Sending" : job ? "Try again" : "Generate video"}
        </button>
      </div>
    );
  }

  const at = STEPS.findIndex(([k]) => k === job.status);
  return (
    <div className="x-box rise" aria-live="polite">
      <div className="row-between">
        <span className="x-label ai">AI-GENERATED</span>
        <span className="x-mono-line">Job {job.id.slice(-6)}</span>
      </div>
      <ol className="x-docket" aria-label="Job status">
        {STEPS.map(([k, l], n) => (
          <li key={k} data-s={n < at ? "done" : n === at ? "now" : ""}><span className="n">0{n + 1}</span><b>{l}</b></li>
        ))}
      </ol>
      {live && (
        <div className="x-prog" role="status">
          <TickBar pct={job.progress} sig label={`Rendering ${job.progress} percent`} />
          <span className="x-mono-line">{job.status === "queued" ? "Waiting for a renderer" : `Rendering, ${job.progress}%`}<span className="caret" aria-hidden="true" /></span>
        </div>
      )}
      {!live && (
        <div className="x-player">
          {job.videoUrl ? <video controls preload="metadata" src={job.videoUrl} aria-label="Generated video preview" /> : <div className="x-slate"><b>AI-generated</b>The service has no playable file for this job yet</div>}
          {job.status === "ready" && (
            <>
              <p className="muted" style={{ fontSize: "0.9rem" }}>Watch it through. Nothing goes to creators until you approve this exact video.</p>
              <div className="row" style={{ gap: 20 }}>
                <button type="button" className="btn" onClick={approve} disabled={busy}>{busy ? "Approving" : "Approve for launch"}</button>
                <button type="button" className="linkbtn" onClick={() => set({ job: null })}>Discard and start over</button>
              </div>
            </>
          )}
          {job.status === "approved" && (
            <div className="row-between">
              <span className="x-label ok">Approved for launch</span>
              <span className="row" style={{ gap: 18 }}>
                {job.videoUrl && <a className="linkbtn" href={job.videoUrl} download>Download</a>}
                <button type="button" className="linkbtn" onClick={() => set({ job: null })}>Start over</button>
              </span>
            </div>
          )}
        </div>
      )}
      {err && <p className="notice warn" role="alert"><b>Stopped.</b>{err}</p>}
    </div>
  );
}

export function SourceStep({ kind, detail, setDetail, src, setSrc }: { kind: SourceKind; detail: string; setDetail: (v: string) => void; src: SourceState; setSrc: (p: Partial<SourceState>) => void }) {
  const stable = useCallback((p: Partial<SourceState>) => setSrc(p), [setSrc]);
  return (
    <div className="stack rise">
      <DemoNote />
      {kind === "upload" && <UploadPart s={src} set={stable} />}
      {kind === "link" && (
        <div className="field">
          <label htmlFor="vl">Video URL</label>
          <input id="vl" inputMode="url" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="https://" />
          <span className="hint">A public address creators can open. Creators cannot download it from Clippo.</span>
        </div>
      )}
      {kind === "generate" && <GeneratePart prompt={detail} setPrompt={setDetail} s={src} set={stable} />}
    </div>
  );
}
