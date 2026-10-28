"use client";
import { useState } from "react";
import type { Campaign } from "@/ui-mocks/data";
import { agentPass, api, errText, type AgentProposalView, type SplitProposal, type WorldProof } from "./api";
import { useAsync, useEscrow } from "./hooks";
import { Correction, Empty, Loading } from "./Bits";
import { money } from "./format";
import { WorldCheck, worldFailText, type WorldResult } from "./WorldCheck";
import { AgentPassPanel, ProposalReasons } from "./AgentPassPanel";

/**
 * Admin side of two-party splits (approver = CAMPAIGNER_AND_ADMIN). The admin reviews the AI agent's proposal and approves that
 * identical split with their own fresh World ID check. The agent never approves anything; refusals show in the Agent Pass log.
 */
export function AdminSplits() {
  const q = useAsync(api.campaigns);
  const escrow = useEscrow();
  const [review, setReview] = useState<{ c: Campaign; p: AgentProposalView } | null>(null);
  const [res, setRes] = useState<Record<string, { p: SplitProposal; tx: string | null }>>({});
  const [err, setErr] = useState("");
  const [panelKey, setPanelKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  /** Loads the agent's current open proposal for this campaign; the admin cannot approve anything the agent has not proposed here. */
  async function open(c: Campaign) {
    setErr("");
    setBusy(c.id);
    try {
      const a = await agentPass.activity(c.id);
      const p = a.proposals.find((x) => x.status === "PROPOSED" && new Date(x.expiresAt).getTime() > Date.now());
      if (!p) setErr("Nothing to approve. The agent has no open proposal for this campaign (none yet, or it expired). Ask the campaigner to request a fresh one.");
      else setReview({ c, p });
    } catch (e) {
      setErr(`Could not load the agent's proposal. ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function done(r: WorldResult, proof?: WorldProof, message?: string) {
    const rv = review;
    setReview(null);
    setErr("");
    if (rv && (r === "cancelled" || r === "expired" || r === "failed")) {
      void agentPass.reportCheck(rv.c.id, r === "cancelled" ? "CANCELLED" : r === "expired" ? "EXPIRED" : "FAILED", rv.p.id, rv.p.splitHash, message).then(() => setPanelKey((k) => k + 1));
    }
    if (r !== "verified" || !proof || !rv) return setErr(`Split not approved. ${worldFailText(null, r, message)}`);
    try {
      const out = await escrow.approveSplit(rv.c.id, rv.p.splits, proof, rv.p.id);
      setRes((x) => ({ ...x, [rv.c.id]: { p: out.proposal, tx: out.txHash } }));
    } catch (e) {
      setErr(`Split not approved. ${worldFailText(e)}`);
    } finally {
      setPanelKey((k) => k + 1);
    }
  }

  if (q.status === "loading") return <Loading rows={3} label="Finding splits waiting on you" />;
  if (q.status === "error") return <Correction what={q.error} onRetry={q.retry} />;
  const list = q.data.filter((c) => c.status === "live" && c.mode === "human_split" && c.approver === "me_and_admin");
  return (
    <div className="stack" style={{ gap: 28 }}>
      {err && <p className="notice warn" role="alert"><b>Nothing changed.</b>{err}</p>}
      {list.length === 0 ? (
        <Empty title="No splits waiting.">Two-party splits appear here once the campaigner has an approved clip to pay.</Empty>
      ) : (
        <ol>
          {list.map((c) => {
            const r = res[c.id];
            return (
              <li key={c.id} className="row-between" style={{ padding: "18px 0", borderBottom: "1px solid var(--rule)", gap: 20 }}>
                <div className="stack" style={{ gap: 6 }}>
                  <b>{c.title}</b>
                  <span className="micro">Pool {money(c.pool, 0)} USDC · two-party split</span>
                  {r && <span className="fig" style={{ fontSize: "0.8rem" }}>{r.p.status === "FINALIZED" ? "Finalized" : r.p.status === "AWAITING_CHAIN" ? "Both approved, awaiting chain confirmation" : `Recorded. Still awaiting ${r.p.awaiting.join(", ") || "approval"}`}</span>}
                </div>
                {!r && <button className="btn sm" disabled={busy === c.id} onClick={() => open(c)}>{busy === c.id ? "Loading the proposal" : "Review the agent's split (admin)"}</button>}
              </li>
            );
          })}
        </ol>
      )}
      <p className="muted" style={{ fontSize: "0.875rem" }}>The agent only proposes. Your World ID check is bound to the exact split hash; if the split changed, expired, or the check is cancelled, expired or reused, nothing happens and it is logged below.</p>
      <AgentPassPanel title="Agent Pass activity (all campaigns)" refreshKey={panelKey} />
      {review && <ProposalReasons p={review.p} />}
      {review && <WorldCheck key={review.p.id} kind="agent-pass" action="clippo-approve-split" signal={`split:${review.c.id}:${review.p.splitHash}`} purpose="Confirm you approve the agent's split" onResult={done} />}
    </div>
  );
}
