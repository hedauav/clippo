"use client";
import { useMemo, useState } from "react";
import { actions, api, errText, type WorldProof } from "./api";
import type { QueueItem } from "@/ui-mocks/data";
import { useAsync, useEscrow, useSession } from "./hooks";
import { WorldCheck, worldFailText, type WorldResult } from "./WorldCheck";
import { AdminSplits } from "./AdminSplits";
import { Correction, DemoNote, Empty, Loading, PageHead } from "./Bits";
import { money } from "./format";
import { Disputes, Growth } from "./AdminAssistant";

const TABS = [
  ["all", "All"],
  ["campaign", "Campaigns to sign"],
  ["clip", "Flagged clips"],
  ["appeal", "Appeals"],
  ["splits", "Splits to approve"],
  ["pattern", "View patterns"],
  ["disputes", "Dispute summaries"],
  ["growth", "Suspicious growth"],
] as const;

const ACTIONS: Record<QueueItem["kind"], [string, "approve" | "reject" | "overturn" | "uphold"][]> = {
  campaign: [["Approve", "approve"], ["Reject and refund", "reject"]],
  clip: [["Clear", "approve"], ["Reject clip", "reject"]],
  appeal: [["Overturn", "overturn"], ["Uphold", "uphold"]],
  pattern: [["Release hold", "approve"], ["Keep hold", "reject"]],
};

export function BenchView() {
  const q = useAsync(api.adminQueue);
  const s = useSession();
  const escrow = useEscrow();
  const [attest, setAttest] = useState<QueueItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const [done, setDone] = useState<Record<string, string>>({});

  const items = useMemo(() => (q.status === "ready" ? q.data.filter((i) => tab === "all" || i.kind === tab).sort((a, b) => a.rank - b.rank) : []), [q, tab]);

  const [reject, setReject] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");

  /** High-value approval: a fresh World ID proof from THIS admin becomes the attestation passed to the on-chain approveCampaign. */
  async function attested(r: WorldResult, proof?: WorldProof, message?: string) {
    const i = attest;
    setAttest(null);
    if (r !== "verified" || !proof || !i) return setErr(`Not approved. ${worldFailText(null, r, message)}`);
    setErr("");
    setBusy(i.id);
    try {
      const a = await actions.attest(i.id, proof);
      await escrow.approve({ id: i.id, onchainId: i.onchainId }, a.attestation);
      setDone((x) => ({ ...x, [i.id]: "Approved and live" }));
    } catch (e) {
      setErr(worldFailText(e));
    }
    setBusy(null);
  }

  async function act(i: QueueItem, label: string, d: "approve" | "reject" | "overturn" | "uphold") {
    setErr("");
    setBusy(i.id);
    try {
      if (i.kind === "campaign") {
        if (d === "approve") {
          if (i.highValue) {
            setAttest(i);
            setBusy(null);
            return;
          }
          await escrow.approve({ id: i.id, onchainId: i.onchainId });
        } else {
          if (reason.trim().length < 5) {
            setBusy(null);
            return setErr("Give the campaigner a reason, at least a few words.");
          }
          await escrow.reject({ id: i.id, onchainId: i.onchainId }, reason.trim());
        }
      } else if (i.kind === "pattern" && i.flagId) {
        await actions.flag(i.flagId, d === "approve" ? "DISMISS" : "CONFIRM");
      } else if (i.kind === "appeal") {
        await actions.verdict(i.id, d === "overturn" ? "APPROVE" : "REJECT", d === "overturn" ? "Appeal overturned by admin." : "Appeal upheld by admin: original verdict stands.");
      } else if (i.kind === "clip") {
        await actions.verdict(i.id, d === "approve" ? "APPROVE" : "REJECT", d === "approve" ? "Cleared by admin after review." : "Rejected by admin after review.");
      }
      setDone((x) => ({ ...x, [i.id]: label }));
      setReject(null);
      setReason("");
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(null);
  }

  return (
    <div className="wrap page">
      <PageHead kicker={<><span>The Bench</span><span>Admin</span><DemoNote /></>} title={<>Read it, then <em>decide</em></>}>
        The assistant ranks the queue and summarises each dispute. It recommends. A person signs.
      </PageHead>

      {s.ready && s.address && s.role !== "admin" && (
        <div className="notice warn" style={{ marginBottom: 28 }} role="note">
          <b>You are viewing as {s.role}.</b>
          <span>The queue only loads for an admin wallet. Admin rights come from the operator&rsquo;s allow-list: connect an allow-listed wallet.</span>
        </div>
      )}

      <div className="seg" role="tablist" aria-label="Queue sections" style={{ marginBottom: 28 }}>
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "splits" && <AdminSplits />}
      {tab === "disputes" && <Disputes />}
      {tab === "growth" && <Growth />}
      {tab !== "disputes" && tab !== "growth" && tab !== "splits" && q.status === "loading" && <Loading rows={5} label="Ranking the queue" />}
      {tab !== "disputes" && tab !== "growth" && tab !== "splits" && q.status === "error" && (
        <div className="stack">
          <Correction what={q.error} fix={s.role === "admin" && s.address ? undefined : "The bench needs an admin wallet."} onRetry={q.retry} />
          {s.role !== "admin" || !s.address ? <button className="btn sm" style={{ justifySelf: "start" }} disabled={s.connecting} onClick={() => s.connect("admin").then(q.retry).catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect admin wallet"}</button> : null}
          {err && <span className="err" role="alert">{err}</span>}
        </div>
      )}
      {tab !== "disputes" && tab !== "growth" && tab !== "splits" && q.status === "ready" && items.length === 0 && <Empty title="Clear desk.">Nothing waiting in this section.</Empty>}
      {tab !== "disputes" && tab !== "growth" && tab !== "splits" && q.status === "ready" && items.length > 0 && (
        <ol aria-live="polite">
          {items.map((i) => (
            <li key={i.id} style={{ display: "grid", gridTemplateColumns: "3.2rem minmax(0,1fr) auto", gap: "6px 20px", padding: "22px 0", borderBottom: "1px solid var(--rule)" }} className="bench-row">
              <span className="display" style={{ fontSize: "2.4rem", lineHeight: 1, color: "var(--ink-3)" }} aria-label={`Priority ${i.rank}`}>{i.rank}</span>
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 10 }}><span className="tag solid">{i.tag}</span><span className="micro">{i.by}</span>{i.amount ? <span className="fig" style={{ fontSize: "0.8rem" }}>${money(i.amount, 0)} USDC</span> : null}</div>
                <h2 style={{ fontFamily: "var(--f-display)", fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.1 }}>{i.title}</h2>
                <div className="note"><span className="micro">{i.noteLabel ?? "Assistant summary"}</span>{i.summary}</div>
                {reject === i.id && !done[i.id] && (
                  <div className="field rise">
                    <label htmlFor={`rr-${i.id}`}>Reason for the campaigner</label>
                    <input id={`rr-${i.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What has to change before this can go live?" />
                    {err && <span className="err" role="alert">{err}</span>}
                    <span className="hint">The pool is refunded in full on-chain. Your wallet signs the refund first.</span>
                  </div>
                )}
                {err && reject !== i.id && <span className="err" style={{ color: "var(--no)", fontWeight: 700, fontSize: "0.8rem" }} role="alert">{err}</span>}
              </div>
              <div className="stack" style={{ alignContent: "start", justifyItems: "end" }}>
                {done[i.id] ? <span className="micro" role="status">{done[i.id]}</span> : (
                  <div className="row">
                    {ACTIONS[i.kind].map(([l, d], k) => (
                      <button key={l} disabled={busy === i.id} className={`btn sm${k ? " ghost" : ""}`} onClick={() => (i.kind === "campaign" && d === "reject" && reject !== i.id ? setReject(i.id) : act(i, l, d))}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {attest && <WorldCheck key={attest.id} kind="agent-pass" action="clippo-approve-campaign" signal={`approve:${attest.id}`} purpose="Confirm you approve this high-value campaign" onResult={attested} />}
    </div>
  );
}
