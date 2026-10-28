"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAsync, useChainInfo, useEscrow, useSession, type FundStep } from "./hooks";
import { actions, api, DEMO, errText } from "./api";
import { previewFund } from "@/lib/chain/client";
import { FAUCET_URL, escrowReady } from "./wallet";
import { Correction, Loading, PageHead } from "./Bits";
import { money } from "./format";
import { Coins } from "./Icons";
import { FeePreview } from "./FeePreview";

type Phase = "ready" | "signing" | "funded" | "failed";

export function FundView() {
  const { id } = useParams<{ id: string }>();
  const q = useSearchParams();
  const s = useSession();
  const escrow = useEscrow();
  const fn = useCallback(() => api.campaign(id), [id]);
  const camp = useAsync(fn);
  const [phase, setPhase] = useState<Phase>("ready");
  const [tx, setTx] = useState("");
  const [err, setErr] = useState("");
  const [step, setStep] = useState<FundStep | null>(null);
  const [ramp, setRamp] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  const chain = useChainInfo();
  const prevFn = useCallback(() => (s.user?.role === "CAMPAIGNER" ? previewFund(id) : Promise.resolve(null)), [id, s.user?.role]);
  const prev = useAsync(prevFn);
  const unconfigured = !DEMO && !!chain && !escrowReady(chain);

  const c = camp.status === "ready" ? camp.data : null;
  const pool = c?.pool ?? (Number(q.get("pool")) || 5000);
  const status = c?.status;
  const funded = phase === "funded" || status === "pending_admin" || status === "live" || status === "rejected";

  async function fund() {
    setPhase("signing");
    setErr("");
    setStep(null);
    try {
      const r = await escrow.fund(id, setStep);
      setTx(r.txHash);
      setPhase("funded");
      camp.retry();
    } catch (e) {
      setErr(errText(e, "The transfer did not go through."));
      setPhase("failed");
    }
    setStep(null);
  }

  /** Fiat on-ramp: the backend creates a Transak session for the pool amount; we open the URL it returns. */
  async function buy() {
    setRamp({ busy: true, msg: "" });
    try {
      const url = await actions.onrampSession(id, pool);
      window.open(url, "_blank", "noopener,noreferrer");
      setRamp({ busy: false, msg: "Opened the card checkout in a new tab. When the USDC lands in your wallet, come back and fund." });
    } catch (e) {
      const nf = (e as { status?: number })?.status === 404;
      setRamp({ busy: false, msg: nf ? "The card on-ramp is not configured on this deployment. Use the testnet faucet instead." : errText(e) });
    }
  }

  const stage = status === "live" ? 2 : funded ? 1 : 0;
  const docket = [
    { t: "Fund", d: funded ? `${money(pool, 0)} USDC in escrow` : "Move the pool into escrow" },
    { t: "Admin review", d: status === "rejected" ? "Rejected. The pool is refundable in full." : funded ? "In the queue. A person reads the brief." : "Starts once the pool is in" },
    { t: "Open to creators", d: status === "live" ? "Live now" : "Verified creators can join" },
    { t: "Close", d: "Unspent USDC returns to you" },
  ];

  if (camp.status === "loading") return <div className="wrap page"><Loading label="Opening escrow" rows={4} /></div>;
  if (camp.status === "error") return <div className="wrap page"><Correction what={camp.error} onRetry={camp.retry} /></div>;

  return (
    <div className="wrap page">
      <PageHead
        kicker={<><Link href="/desk">Desk</Link><span>{c ? `No. ${c.serial}` : "No. pending"}</span></>}
        title={status === "live" ? <>Signed. <em>Live now.</em></> : status === "rejected" ? <>Not approved. <em>Pool returns.</em></> : funded ? <>In escrow. <em>Waiting on admin.</em></> : <>Fund the <em>pool</em></>}
      >
        {funded
          ? "Creators can’t see this campaign until an admin signs it. If it is rejected, the whole pool comes back to you."
          : "The pool goes into escrow before an admin looks at the campaign. It is refundable in full if the admin says no."}
      </PageHead>

      <ol className="docket" aria-label="Campaign status">
        {docket.map((d, i) => (
          <li key={d.t} data-s={i < stage ? "done" : i === stage ? "now" : ""} aria-current={i === stage ? "step" : undefined}>
            <span className="n">{i + 1}</span>
            <b>{d.t}</b>
            <span className="muted" style={{ fontSize: "0.875rem" }}>{d.d}</span>
          </li>
        ))}
      </ol>

      <div className="cols flip" style={{ marginTop: 48 }}>
        <div className="stack-lg">
          {phase === "failed" && <Correction what={err} fix="Nothing left your wallet. Check you have USDC on Arc and try again." onRetry={fund} />}

          {!funded ? (
            <section className="stack" aria-labelledby="amt">
              <h2 id="amt" className="sr">Amount</h2>
              <span className="micro">Pool</span>
              <div className="fig-xl">{money(pool, 0)} <span className="micro">USDC</span></div>
              {!s.address || s.role !== "campaigner" ? (
                <div className="notice"><b>Connect the campaigner wallet that holds the USDC.</b><button className="btn sm" style={{ justifySelf: "start", marginTop: 6 }} disabled={s.connecting} onClick={() => s.connect("campaigner").catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect wallet"}</button></div>
              ) : (
                <div className="row" style={{ gap: 20 }}>
                  <button className="btn" onClick={fund} disabled={phase === "signing" || unconfigured}>
                    <Coins size={18} /> {phase === "signing" ? (step === "approve" ? "Approve USDC in your wallet" : step === "create" ? "Confirm the deposit" : step === "verify" ? "Verifying on-chain" : "Waiting for signature") : `Fund ${money(pool, 0)} USDC`}
                  </button>
                  <Link href="/desk/new" className="linkbtn">Change the answers</Link>
                </div>
              )}
              {unconfigured && <div className="notice warn" role="alert"><b>Escrow is not configured on this deployment.</b>The contract address is not set, so funding is switched off and nothing can be sent. An operator needs to set the escrow address.</div>}
              <p className="muted" role="status" aria-live="polite">
                {phase === "signing"
                  ? step === "approve" ? "Step 1 of 2: approve the escrow to take the pool in USDC. Gas is paid in USDC."
                  : step === "create" ? "Step 2 of 2: confirm the deposit into escrow."
                  : step === "verify" ? "The service is reading the receipt on-chain before it counts the funds."
                  : "Confirm in your wallet. Gas is paid in USDC."
                  : "Funding is two wallet confirmations: allow USDC, then deposit the pool. The service verifies the receipt on-chain before the campaign counts as funded."}
              </p>
              <div className="row" style={{ gap: 20 }}>
                <button type="button" className="btn ghost sm" onClick={buy} disabled={ramp.busy}>{ramp.busy ? "Opening checkout" : "Buy USDC with a card"}</button>
                <a className="linkbtn" href={FAUCET_URL} target="_blank" rel="noreferrer noopener">Testnet USDC faucet</a>
              </div>
              {ramp.msg && <p className="muted" role="status">{ramp.msg}</p>}
              {prev.status === "ready" && prev.data?.preview.highValue && <p className="notice" role="note"><b>High-value pool.</b>Above ${money(prev.data.fees.highValueThresholdUsdc, 0)} net, so approval needs a fresh World ID check by an admin. Expect a longer review.</p>}
            </section>
          ) : (
            <section className="stack" aria-labelledby="done">
              <h2 id="done" className="sr">Funded</h2>
              {tx && <div className="notice" role="status"><b>Transfer confirmed and verified</b><span className="fig" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>tx {tx}</span></div>}
              <p className="prose">
                {status === "live" ? "Creators can join and submit clips." : "You will see the decision here and on your desk. Until then the pool, rate and payout rule are locked."}
              </p>
              <div className="row" style={{ gap: 20 }}>
                <Link href="/desk" className="btn">Go to the desk</Link>
                <Link href="/wire" className="btn ghost">See the wire</Link>
              </div>
            </section>
          )}
        </div>

        <aside className="rail" aria-label="What this costs">
          <span className="micro">The arithmetic</span>
          <dl className="kv">
            <dt>Pool</dt><dd>{money(pool)}</dd>
            <dt>Gas</dt><dd>paid in USDC</dd>
          </dl>
          {prev.status === "ready" && prev.data ? (
            <div className="receipt" aria-live="polite">
              <span className="micro">Fee preview, funding</span>
              <div className="line"><span>Pool you send</span><span>{money(prev.data.preview.poolAmount)}</span></div>
              <div className="line"><span>Platform fee, {(prev.data.preview.campaignerFeeBps / 100).toFixed(2)}%</span><span>-{money(prev.data.preview.campaignerFee)}</span></div>
              <div className="line total"><span>Net pool for creators</span><span>{money(prev.data.preview.netPool)}</span></div>
              <span className="muted" style={{ fontSize: "0.75rem" }}>From the service, as the escrow will charge it.</span>
            </div>
          ) : <FeePreview kind="fund" amount={pool} />}
          <p className="muted" style={{ fontSize: "0.8rem" }}>The campaigner fee is taken by the escrow when you fund. Creators pay their own share when they claim. Unspent USDC returns at close.</p>
        </aside>
      </div>
    </div>
  );
}
