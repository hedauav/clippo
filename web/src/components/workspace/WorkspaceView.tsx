"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAsync, useEscrow, useSession, type FundStep } from "../hooks";
import { pctText, useFees } from "../FeePreview";
import { ws, errText } from "../api";
import { Correction, DemoNote, Empty, Loading, PageHead, TickBar } from "../Bits";
import { Coins } from "../Icons";
import type { Status, Workspace } from "@/ui-mocks/workspace";
import { money } from "./parts";
import { ApprovalLedger, BriefSpec, TrackingList, approvedTotal, isFunded } from "./panels";

type Tab = "approvals" | "tracking" | "brief";
const TABS: { k: Tab; t: string }[] = [
  { k: "approvals", t: "Approvals" },
  { k: "tracking", t: "Tracking" },
  { k: "brief", t: "Brief" },
];

function ShareLine({ token }: { token: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setUrl(`${window.location.origin}/hire/share/${token}`), 0);
    return () => clearTimeout(t);
  }, [token]);
  return (
    <div className="ws-share">
      <span className="micro">Shared view, read only. For you and every creator on it.</span>
      <span className="url">{url}</span>
      <div className="copy-row">
        <button
          className="btn sm ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <a className="linkbtn" href={url}>Open</a>
      </div>
    </div>
  );
}

export function WorkspaceView() {
  const { id } = useParams<{ id: string }>();
  const fn = useCallback(() => ws.workspace(id), [id]);
  const loaded = useAsync(fn);
  const s = useSession();
  const escrow = useEscrow();
  const fees = useFees();
  const [step, setStep] = useState<FundStep | null>(null);
  const [w, setW] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<Tab>("approvals");
  const [phase, setPhase] = useState<"idle" | "signing" | "failed">("idle");
  const [err, setErr] = useState("");
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    if (loaded.status !== "ready") return;
    const t = setTimeout(() => {
      setW(loaded.data);
      if (loaded.data && isFunded(loaded.data)) setTab("tracking");
    }, 0);
    return () => clearTimeout(t);
  }, [loaded.status, loaded.data]);

  if (loaded.status === "loading") return <div className="wrap page"><Loading label="Opening the workspace" rows={6} /></div>;
  if (loaded.status === "error") return <div className="wrap page"><Correction what="The workspace did not load." fix={errText(loaded.error)} onRetry={loaded.retry} /></div>;
  if (!loaded.data)
    return (
      <div className="wrap page">
        <Empty title="No workspace under that number." action={<Link href="/hire" className="btn sm">Back to the directory</Link>}>
          It may have been removed, or the link is wrong. Workspaces belong to the campaigner account that wrote the brief; use its shared link if you were invited.
        </Empty>
      </div>
    );
  if (!w) return <div className="wrap page"><Loading label="Opening the workspace" rows={6} /></div>;

  const funded = isFunded(w);
  const total = approvedTotal(w.lines);
  const approved = w.lines.filter((l) => l.status === "APPROVED").length;
  const pending = w.lines.filter((l) => l.status === "PROPOSED").length;
  const cap = w.cap;
  const over = cap != null && total > cap;
  const pct = cap ? (total / cap) * 100 : 0;
  const isCampaigner = !!s.address && s.role === "campaigner";

  async function decide(creatorId: string, d: Status) {
    if (!w || funded) return;
    const prev = w;
    setW({ ...w, lines: w.lines.map((l) => (l.creatorId === creatorId ? { ...l, status: d } : l)) });
    setSaveErr("");
    try {
      const saved = await ws.setStatus(w, creatorId, d);
      setW((cur) => (cur ? { ...cur, token: saved.token } : saved));
    } catch (e) {
      setW(prev);
      setSaveErr(errText(e));
    }
  }

  async function fundAll() {
    if (!w) return;
    setPhase("signing");
    setErr("");
    try {
      /* 1) the service creates one HUMAN_SPLIT campaign for the approved creators; 2) you fund it on-chain; 3) the service verifies the receipt. */
      const campaignId = await ws.createFunding(w);
      const r = await escrow.fund(campaignId, setStep);
      const next = await ws.reload({ ...w, campaignId }, r.txHash);
      setW(next);
      setPhase("idle");
      setTab("tracking");
    } catch (e) {
      setErr(errText(e, "The transfer did not go through."));
      setPhase("failed");
    }
    setStep(null);
  }

  const blocker = funded
    ? ""
    : approved === 0
      ? "Approve at least one creator to fund."
      : over && cap != null
        ? `Approved total is $${money(total - cap, 0)} over the cap. Pass on someone or raise the cap in a new brief.`
        : "";

  return (
    <div className="wrap page">
      <PageHead
        kicker={<><Link href="/hire">Hire</Link><span>No. {w.serial}</span><span>{funded ? "Funded" : "Draft"}</span></>}
        title={<>{w.title}</>}
      >
        {funded
          ? `${money(total)} USDC is in escrow for ${approved} creators. Each is paid only after their clip passes verification.`
          : `${w.lines.length} offers out. Approve each creator, watch the total, then fund everyone in one step.`}
      </PageHead>
      <DemoNote />

      <div className="seg ws-tabs" role="group" aria-label="Workspace sections" style={{ marginTop: 16 }}>
        {TABS.map((t) => (
          <button key={t.k} aria-pressed={tab === t.k} onClick={() => setTab(t.k)}>{t.t}</button>
        ))}
      </div>

      <div className="cols flip ws-cols" style={{ marginTop: 24 }}>
        <section className="stack-lg" aria-live="polite">
          {saveErr && <Correction what="That decision was not saved." fix={saveErr} />}
          {tab === "approvals" && (
            <>
              <ApprovalLedger w={w} controls={funded ? undefined : { onDecide: decide }} />
              {!funded && pending > 0 && <p className="muted">{pending} still awaiting your decision. Pass is not final until you fund, so you can change your mind.</p>}
            </>
          )}
          {tab === "tracking" && <TrackingList w={w} />}
          {tab === "brief" && <BriefSpec w={w} />}
        </section>

        <aside className="rail" aria-label="Budget and funding">
          <div className={`ws-total${over ? " over" : ""}`} role="status" aria-live="polite">
            <span className="micro">{funded ? "In escrow" : "Approved so far"}</span>
            <div className="big">
              <span className="fig-xl" aria-label={`${money(total)} USDC`}>${money(total, 0)}</span>
              {cap != null && <span className="micro">of ${money(cap, 0)} cap</span>}
            </div>
            {cap != null && <TickBar pct={pct} sig={!over} label={`${Math.round(pct)} percent of the budget cap approved`} />}
            <dl className="kv">
              <dt>Creators approved</dt><dd>{approved} of {w.lines.length}</dd>
              {cap != null && <><dt>Headroom</dt><dd>{over ? "-" : ""}${money(Math.abs(cap - total), 0)}</dd></>}
              <dt>Fee{fees && fees !== "failed" ? `, ${pctText(fees.campaignerBps)}` : ""}</dt><dd>{fees && fees !== "failed" ? `$${money((total * fees.campaignerBps) / 10000)}` : fees === "failed" ? "unavailable" : "…"}</dd>
            </dl>
            {over && cap != null && <span className="over-note">Over the cap by ${money(total - cap, 0)}.</span>}
          </div>

          {!funded && (
            <div className="stack">
              {phase === "failed" && <Correction what={err} fix="Nothing left your wallet. Check you have USDC on Arc and try again." onRetry={fundAll} />}
              {!isCampaigner ? (
                <div className="notice">
                  <b>Connect the campaigner wallet that holds the USDC.</b>
                  <button className="btn sm" style={{ justifySelf: "start", marginTop: 6 }} disabled={s.connecting} onClick={() => s.connect("campaigner").catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect wallet"}</button>
                </div>
              ) : (
                <button className="btn" onClick={fundAll} disabled={!!blocker || phase === "signing"} aria-describedby="fund-why">
                  <Coins size={18} /> {phase === "signing" ? (step === "approve" ? "Approve USDC in your wallet" : step === "create" ? "Confirm the deposit" : step === "verify" ? "Verifying on-chain" : "Working") : `Fund all, $${money(total, 0)}`}
                </button>
              )}
              <p className="muted" id="fund-why" style={{ fontSize: "0.875rem" }}>
                {blocker || "One deposit to the escrow covers every approved creator. Unspent USDC returns at close. The service verifies the receipt on-chain before the hire counts as funded."}
              </p>
            </div>
          )}
          {funded && w.fundTx && <p className="fig" style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>tx {w.fundTx}</p>}
          {w.token && <ShareLine token={w.token} />}
        </aside>
      </div>
    </div>
  );
}
