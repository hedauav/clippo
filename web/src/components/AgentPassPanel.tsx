"use client";
import { useCallback } from "react";
import { agentPass, type AgentActivity, type AgentProposalView, type AuditEntry } from "./api";
import { useAsync } from "./hooks";
import { Correction, Loading } from "./Bits";
import { money } from "./format";

const short = (s: string, n = 10) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

const OUTCOME: Record<string, string> = {
  OK: "Done",
  CANCELLED: "Check cancelled",
  EXPIRED_PROOF: "Check expired",
  PROPOSAL_EXPIRED: "Proposal expired",
  REPLAYED: "Proof reused",
  WRONG_APPROVER: "Wrong approver",
  SPLIT_CHANGED: "Split changed",
  ALREADY_RELEASED: "Already released",
  ALREADY_APPROVED: "Already approved",
  PROOF_INVALID: "Proof rejected",
  AGENT_UNVERIFIED: "Agent not verified",
  AI_REJECTED: "AI proposal rejected, non-AI split used",
  REFUSED: "Refused",
};
const PROOF: Record<string, string> = { VALID: "valid", NONE: "none", CANCELLED: "cancelled", EXPIRED: "expired", REPLAYED: "replayed", INVALID: "invalid" };
const EVENT: Record<AuditEntry["event"], string> = { DELEGATED: "Agent delegated", PROPOSED: "Agent proposed", APPROVED: "Human approved", REFUSED: "Refused, nothing changed" };

/** Why the agent proposed each amount, so approvers can judge it. Reasons are the model's own words: advisory text, rendered as plain text. */
export function ProposalReasons({ p }: { p: AgentProposalView }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="micro">
        {p.source === "llm" ? "Written by the AI (advisory, re-checked by software)" : "Non-AI option: pro rata to approved clips"}
        {p.source === "llm" && typeof p.confidence === "number" ? ` · model confidence ${Math.round(p.confidence * 100)}%` : ""}
      </span>
      {p.fallback && <span className="muted" style={{ fontSize: "0.8rem" }}>The AI answer was rejected ({p.fallback.code.toLowerCase().replace(/_/g, " ")}), so this is the non-AI split. {p.fallback.violations.join("; ")}</span>}
      {p.flags && p.flags.length > 0 && <span className="muted" style={{ fontSize: "0.8rem" }}>Flags: {p.flags.join(", ")}</span>}
      <ul>
        {p.splits.map((s) => (
          <li key={s.creatorWallet} className="muted" style={{ fontSize: "0.8rem" }}>
            <span className="fig">{short(s.creatorWallet, 8)}</span> · {money(s.amount, 2)} USDC{s.reason ? `: ${s.reason}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Agent Pass activity": what the agent proposed, who approved, the proof status, and every refusal.
 * Campaign desk: pass `campaignId`. Bench: omit it for the cross-campaign admin feed. `refreshKey` reloads after an action.
 */
export function AgentPassPanel({ campaignId, title, refreshKey = 0 }: { campaignId?: string; title?: string; refreshKey?: number }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is the reload trigger
  const load = useCallback(() => (campaignId ? agentPass.activity(campaignId) : agentPass.feed()), [campaignId, refreshKey]);
  const q = useAsync<AgentActivity>(load);
  const h = `ap-${campaignId ?? "all"}`;

  return (
    <section className="stack" style={{ gap: 12 }} aria-labelledby={h}>
      <div className="row-between">
        <h3 id={h} style={{ fontFamily: "var(--f-display)", fontSize: "1.3rem" }}>{title ?? "Agent Pass activity"}</h3>
        <span className="micro">{q.status === "ready" && q.data.mode === "demo" ? "Demo identity (fake human)" : "World AgentKit"}</span>
      </div>
      {q.status === "loading" && <Loading rows={2} label="Reading the agent log" />}
      {q.status === "error" && <Correction what="The agent log did not load." cause={q.error} onRetry={q.retry} />}
      {q.status === "ready" && (
        <>
          {q.data.agents && (
            <p className="muted" style={{ fontSize: "0.875rem" }}>
              {q.data.agents.length === 0
                ? "No agent is delegated to this campaign yet. It is delegated the first time you ask it for a proposal."
                : q.data.agents.map((a) => `Agent ${short(a.address, 8)} · ${a.mode === "demo" ? "demo identity" : "human-backed in AgentBook"} · ${a.status.toLowerCase()}`).join(" · ")}
            </p>
          )}
          <div className="stack" style={{ gap: 6 }}>
            <span className="micro">Proposed by the agent</span>
            {q.data.proposals.length === 0 && <span className="muted" style={{ fontSize: "0.875rem" }}>Nothing proposed yet.</span>}
            {q.data.proposals.map((p) => (
              <div key={p.id} className="row-between" style={{ gap: 16, padding: "10px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                <div className="stack" style={{ gap: 2 }}>
                  <b style={{ fontSize: "0.9rem" }}>{p.campaignTitle ? `${p.campaignTitle}: ` : ""}{money(p.total, 2)} USDC to {p.splits.length} creator{p.splits.length === 1 ? "" : "s"}</b>
                  <span className="fig" style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>split {short(p.splitHash, 12)}</span>
                  <span className="muted" style={{ fontSize: "0.8rem" }}>{p.rationale}</span>
                  <ProposalReasons p={p} />
                </div>
                <div className="stack" style={{ gap: 4, justifyItems: "end" }}>
                  <span className="tag">{p.status.toLowerCase()}</span>
                  <span className="micro">
                    {p.approval ? `Campaigner ${p.approval.campaigner ? "approved" : "not yet"} · Admin ${p.approval.admin ? "approved" : "not yet"}` : "No human approval yet"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="micro">Audit log</span>
            {q.data.audit.length === 0 && <span className="muted" style={{ fontSize: "0.875rem" }}>No activity yet.</span>}
            <ol aria-live="polite">
              {q.data.audit.map((a) => (
                <li key={a.id} className="stack" style={{ gap: 2, padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className={`tag${a.event === "REFUSED" ? "" : " solid"}`}>{a.event === "REFUSED" ? OUTCOME[a.outcome] ?? a.outcome : EVENT[a.event]}</span>
                    <span className="micro">{a.actorRole ? a.actorRole.toLowerCase() : "system"} · proof {a.proofStatus ? PROOF[a.proofStatus] ?? a.proofStatus.toLowerCase() : "none"}{a.source === "client" ? " · reported by the page" : ""}</span>
                    <span className="micro">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                  <span style={{ fontSize: "0.875rem" }}>{a.campaignTitle ? `${a.campaignTitle}. ` : ""}{a.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
