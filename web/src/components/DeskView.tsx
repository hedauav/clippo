"use client";
import { useState } from "react";
import Link from "next/link";
import { actions, agentPass, api, errText, type AgentProposalView, type SplitProposal } from "./api";
import { normalizeSplit, splitHash } from "@/lib/chain/split";
import { AgentPassPanel } from "./AgentPassPanel";
import type { Campaign, Submission } from "@/ui-mocks/data";
import { useAsync, useEscrow, useSession } from "./hooks";
import { Correction, DemoNote, Empty, Loading, PageHead, TickBar } from "./Bits";
import { MODE_LABEL, compact, money } from "./format";
import { Stamp } from "./Stamp";
import { DeskAnalytics } from "./DeskAnalytics";
import { WorldCheck, worldFailText, type WorldResult } from "./WorldCheck";
import type { WorldProof } from "./api";

export function DeskView() {
  const camps = useAsync(api.myCampaigns);
  const hold = useAsync(api.needsHuman);
  const escrow = useEscrow();
  const s = useSession();
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [closed, setClosed] = useState<Record<string, string>>({});
  /** The split waiting on the human World ID check: the agent's proposal (proposalId set) or one the campaigner built. */
  const [review, setReview] = useState<null | { c: Campaign; splits: { creatorWallet: string; amount: number }[]; hash: string; proposalId?: string }>(null);
  const [agentProp, setAgentProp] = useState<Record<string, AgentProposalView>>({});
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [proposals, setProposals] = useState<Record<string, SplitProposal>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  async function decide(s: Submission, d: "approve" | "reject") {
    try {
      await actions.verdict(s.id, d === "approve" ? "APPROVE" : "REJECT", d === "approve" ? "Approved by the campaigner after review." : "Rejected by the campaigner after review.");
      setDecided((x) => ({ ...x, [s.id]: d === "approve" ? "Approved by you" : "Rejected by you" }));
    } catch (e) {
      setMsg({ kind: "bad", text: errText(e) });
    }
  }
  async function close(c: Campaign) {
    try {
      /* On-chain closeCampaign first (the unallocated pool comes back to your wallet), then the API verifies it. */
      const r = (await escrow.close(c)) as { txHash?: string };
      setClosed((x) => ({ ...x, [c.id]: r?.txHash ? `${r.txHash.slice(0, 10)}…` : "done" }));
      camps.retry();
    } catch (e) {
      setMsg({ kind: "bad", text: errText(e) });
    }
  }
  /** Agent Pass: the AI agent (delegated by you, registered in AgentBook) proposes a split. It only proposes; nothing is payable until you pass a World ID check. */
  async function askAgent(c: Campaign, mode: "llm" | "deterministic" = "llm") {
    setBusyAgent(c.id);
    setMsg(null);
    try {
      await agentPass.delegate(c.id);
      const p = await agentPass.propose(c.id, mode);
      setAgentProp((x) => ({ ...x, [c.id]: p }));
      setMsg({ kind: "ok", text: `The agent proposed ${money(p.total, 2)} USDC across ${p.splits.length} creator${p.splits.length === 1 ? "" : "s"}. Review it, then approve with a fresh World ID check. Nothing is payable yet.` });
    } catch (e) {
      setMsg({ kind: "bad", text: `No proposal. ${errText(e)}` });
    } finally {
      setBusyAgent(null);
      setPanelKey((k) => k + 1);
    }
  }
  /** Without the agent: build the split from approved clips yourself (same human check, no agent attribution). */
  async function buildMyself(c: Campaign) {
    try {
      const plan = await actions.splitPlan(c);
      const norm = normalizeSplit(plan.splits);
      setReview({ c, splits: plan.splits, hash: splitHash(norm) });
    } catch (e) {
      setMsg({ kind: "bad", text: `Split not approved. ${errText(e)}` });
    }
  }
  /** One approver's split approval. Each approver (campaigner, then admin) runs their OWN fresh World ID check on the identical split. */
  async function worldDone(r: WorldResult, proof?: WorldProof, message?: string) {
    const rv = review;
    setReview(null);
    if (rv && (r === "cancelled" || r === "expired" || r === "failed")) {
      void agentPass.reportCheck(rv.c.id, r === "cancelled" ? "CANCELLED" : r === "expired" ? "EXPIRED" : "FAILED", rv.proposalId, rv.hash, message).then(() => setPanelKey((k) => k + 1));
    }
    if (r !== "verified" || !proof) return setMsg({ kind: "bad", text: `Split not approved. ${worldFailText(null, r, message)}` });
    if (!rv) return;
    const c = rv.c;
    try {
      const res = await escrow.approveSplit(c.id, rv.splits, proof, rv.proposalId);
      setPanelKey((k) => k + 1);
      setAgentProp((x) => { const n = { ...x }; if (res.proposal.status !== "PENDING") delete n[c.id]; return n; });
      setProposals((p) => ({ ...p, [c.id]: res.proposal }));
      const st = res.proposal.status;
      setMsg({
        kind: "ok",
        text:
          st === "FINALIZED"
            ? `Split finalized for ${rv.splits.length} creator${rv.splits.length === 1 ? "" : "s"}. They can claim now.`
            : st === "AWAITING_CHAIN"
              ? "Both approvals are in. Waiting for the chain to confirm the split. Credits appear once the escrow reports it."
              : `Your approval is recorded${res.txHash ? " and sent on-chain" : ""}. Awaiting ${res.proposal.awaiting.join(" and ")}: they must approve the identical split with their own World ID check. Nothing is payable yet.`,
      });
    } catch (e) {
      setPanelKey((k) => k + 1);
      const code = (e as { code?: string }).code;
      if (code === "PROPOSAL_EXPIRED" || code === "SPLIT_CHANGED" || code === "AGENT_REVOKED") setAgentProp((x) => { const n = { ...x }; delete n[c.id]; return n; });
      setMsg({ kind: "bad", text: `Split not approved. ${worldFailText(e)}` });
    }
  }

  return (
    <div className="wrap page">
      <PageHead kicker={<><span>The Desk</span><span>Campaigner</span><DemoNote /></>} title={<>Your <em>campaigns</em></>}>
        What is live, what is waiting on you, and what is still in escrow.
      </PageHead>
      <div className="row" style={{ marginBottom: 32 }}>
        <Link href="/desk/new" className="btn">New campaign</Link>
      </div>

      {msg && <div className={`notice${msg.kind === "bad" ? " warn" : ""}`} role="status" style={{ marginBottom: 28 }}><b>{msg.kind === "ok" ? "Recorded" : "Nothing changed"}</b>{msg.text}</div>}
      {Object.entries(proposals).map(([cid, p]) => {
        const c = camps.status === "ready" ? camps.data.find((x) => x.id === cid) : null;
        return (
          <div key={cid} className="notice" role="status" style={{ marginBottom: 28 }}>
            <b>Split proposal{c ? `: ${c.title}` : ""}</b>
            <span className="fig" style={{ fontSize: "0.8rem" }}>{p.status === "PENDING" ? "Awaiting " + (p.awaiting.join(", ") || "approval") : p.status === "AWAITING_CHAIN" ? "Awaiting chain confirmation" : p.status === "FINALIZED" ? "Finalized" : p.status}</span>
            <span className="fig" style={{ fontSize: "0.8rem" }}>Campaigner {p.approvals.campaigner ? "approved" : "not yet"} · Admin {p.approvals.admin ? "approved" : "not yet"}</span>
            <span className="fig" style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>split {p.splitHash}</span>
          </div>
        );
      })}

      {camps.status === "ready" && camps.data.length > 0 && <DeskAnalytics />}

      <section aria-labelledby="slips">
        <div className="section-title"><h2 id="slips">Campaigns</h2></div>
        {camps.status === "loading" && <Loading rows={3} label="Opening your books" />}
        {camps.status === "error" && (
          <div className="stack">
            <Correction what={camps.error} fix={s.address ? undefined : "Connect a campaigner wallet first."} onRetry={s.address ? camps.retry : undefined} />
            {!s.address && <button className="btn sm" style={{ justifySelf: "start" }} disabled={s.connecting} onClick={() => s.connect("campaigner").then(camps.retry).catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect as a campaigner"}</button>}
          </div>
        )}
        {camps.status === "ready" && camps.data.length === 0 && <Empty title="No campaigns yet." clip={3} action={<Link href="/desk/new" className="btn sm">Start one</Link>}>Eight questions, then fund it.</Empty>}
        {camps.status === "ready" && camps.data.length > 0 && (
          <div className="ledger-wrap">
            <table className="ledger reflow">
              <caption className="sr">Your campaigns</caption>
              <thead><tr><th scope="col">Campaign</th><th scope="col">Pool used</th><th scope="col" className="n">Allocated</th><th scope="col" className="n">Views</th><th scope="col"><span className="sr">Actions</span></th></tr></thead>
              <tbody>
                {camps.data.map((c) => (
                  <tr key={c.id}>
                    <td className="lead-cell">
                      <Link href={`/slips/${c.id}`} className="handle">{c.title}</Link>
                      <span className="sub">No. {c.serial} · {MODE_LABEL[c.mode]} · {c.status.replace("_", " ")}</span>
                    </td>
                    <td data-l="Pool used" style={{ minWidth: 140 }}><TickBar pct={(c.paid / c.pool) * 100} label={`${Math.round((c.paid / c.pool) * 100)} percent used`} /></td>
                    <td className="n" data-l="Allocated">${money(c.paid, 0)} / {money(c.pool, 0)}</td>
                    <td className="n" data-l="Views">{compact(c.views)}</td>
                    <td data-l="">
                      <div className="cell-actions">
                        {c.status === "awaiting_funds" && <Link href={`/desk/${c.id}/fund?pool=${c.pool}`} className="btn sm">Fund {money(c.pool, 0)} USDC</Link>}
                        {c.status === "live" && c.mode === "human_split" && (agentProp[c.id] ? (
                          <>
                            <button className="btn sm" onClick={() => setReview({ c, splits: agentProp[c.id]!.splits, hash: agentProp[c.id]!.splitHash, proposalId: agentProp[c.id]!.id })}>{c.approver === "me_and_admin" ? "Approve agent's split (1 of 2)" : "Approve agent's split"}</button>
                            <button className="btn ghost sm" disabled={busyAgent === c.id} onClick={() => askAgent(c)}>Ask the AI again</button>
                            <button className="btn ghost sm" disabled={busyAgent === c.id} onClick={() => askAgent(c, "deterministic")}>Propose without AI</button>
                          </>
                        ) : (
                          <>
                            <button className="btn sm" disabled={busyAgent === c.id} onClick={() => askAgent(c)}>{busyAgent === c.id ? "Agent is working" : "Ask the AI to propose"}</button>
                            <button className="btn ghost sm" disabled={busyAgent === c.id} onClick={() => askAgent(c, "deterministic")}>Propose without AI (pro rata by clips)</button>
                            <button className="btn ghost sm" onClick={() => buildMyself(c)}>{c.approver === "me_and_admin" ? "Build it myself (1 of 2)" : "Build it myself"}</button>
                          </>
                        ))}
                        {c.status === "live" && (closed[c.id] ? <span className="micro">Closed · {closed[c.id]}</span> : <button className="btn ghost sm" onClick={() => close(c)}>Close and reclaim ${money(c.pool - c.paid, 0)}</button>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="await">
        <div className="section-title"><h2 id="await">Waiting on your call</h2><span className="micro">Agent was not sure</span></div>
        {hold.status === "loading" && <Loading rows={2} label="Checking the tray" />}
        {hold.status === "error" && <Correction what="The review tray did not load." cause={hold.error} onRetry={hold.retry} />}
        {hold.status === "ready" && hold.data.length === 0 && <Empty title="Tray is empty." clip={5}>Clips the agent can&rsquo;t call land here.</Empty>}
        {hold.status === "ready" && hold.data.length > 0 && (
          <ul aria-live="polite">
            {hold.data.map((s) => (
              <li key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 20, padding: "18px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                <div className="stack" style={{ gap: 8 }}>
                  <span className="micro">{s.handle} · {s.platform}</span>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 700 }}>{s.title}</a>
                  <div className="note"><span className="micro">Agent note</span>{s.reason}</div>
                </div>
                <div className="stack" style={{ justifyItems: "end", alignContent: "start" }}>
                  {decided[s.id] ? <span className="micro" role="status">{decided[s.id]}</span> : (
                    <>
                      <Stamp verdict="needs_human" conf={s.confidence} />
                      <div className="row" style={{ marginTop: 8 }}>
                        <button className="btn sm" onClick={() => decide(s, "approve")}>Approve</button>
                        <button className="btn ghost sm" onClick={() => decide(s, "reject")}>Reject</button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {camps.status === "ready" && camps.data.filter((c) => c.mode === "human_split").map((c) => (
        <section key={c.id} className="section" aria-label={`Agent Pass activity for ${c.title}`}>
          <AgentPassPanel campaignId={c.id} title={`Agent Pass activity: ${c.title}`} refreshKey={panelKey} />
        </section>
      ))}
      {review && <WorldCheck key={review.c.id + review.hash} kind="agent-pass" action="clippo-approve-split" signal={`split:${review.c.id}:${review.hash}`} purpose={review.proposalId ? "Confirm you approve the agent's split" : "Confirm you approve this split"} onResult={worldDone} />}
    </div>
  );
}
