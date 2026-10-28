"use client";
import { useEffect, useMemo, useState } from "react";
import { api, DEMO, errText } from "./api";
import { useAsync, useChainInfo, useEscrow, useSession } from "./hooks";
import { escrowReady } from "./wallet";
import { Correction, DemoNote, Empty, Loading, PageHead } from "./Bits";
import { MODE_LABEL, money, whole } from "./format";
import { Coins } from "./Icons";
import { CreatorHead, ModuleLinks, MySubmissions } from "./LedgerDash";
import { FeePreview } from "./FeePreview";

export function LedgerView() {
  const e = useAsync(api.earnings);
  const s = useSession();
  const escrow = useEscrow();
  const chain = useChainInfo();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [txs, setTxs] = useState<string[]>([]);

  const data = e.status === "ready" ? e.data : null;
  const rows = useMemo(() => (data ? data.payouts : []), [data]);
  const owed = (r: (typeof rows)[number]) => r.outstanding ?? r.amount;
  /* Open = not fully claimed. Ready = open, not frozen by review, and past the retention window. The server re-checks at claim time. */
  const open = rows.filter((r) => !r.claimed && owed(r) > 0);
  const ready = open.filter((r) => !r.frozen && (!r.releaseAt || new Date(r.releaseAt).getTime() <= now));
  const claimable = ready.reduce((a, r) => a + owed(r), 0);
  const frozenTotal = open.filter((r) => r.frozen).reduce((a, r) => a + owed(r), 0);
  const claimedTotal = rows.filter((r) => r.claimed).reduce((a, r) => a + r.amount, 0);
  const unconfigured = !DEMO && !!chain && !escrowReady(chain);

  /** Claims are separate per campaign, so one failed transfer never blocks the others. */
  async function claim(ids: string[]) {
    setBusy(true);
    setErr("");
    setTxs([]);
    const bad: string[] = [];
    const good: string[] = [];
    for (const id of ids) {
      try {
        good.push((await escrow.claim(id)).txHash);
      } catch (x) {
        bad.push(errText(x, "The claim did not go through. Your balance is unchanged."));
      }
    }
    setTxs(good);
    if (bad.length) setErr(bad.length === ids.length ? bad[0] : `${bad.length} of ${ids.length} claims did not go through: ${bad[0]}`);
    if (good.length) e.retry();
    setBusy(false);
  }

  return (
    <div className="wrap page">
      <PageHead kicker={<><span>The Ledger</span><span>Creator earnings</span><DemoNote /></>} title={<>What you&rsquo;re <em>owed</em></>}>
        Settled amounts, ready to pull. The creator fee comes off when you claim. Nobody else can hold your money up.
      </PageHead>

      {e.status === "loading" && <Loading rows={5} label="Balancing the books" />}
      {e.status === "error" && (
        <div className="stack">
          <Correction what={e.error} fix={s.address ? "Your money is on-chain and unaffected." : "Connect a creator wallet to see your ledger."} onRetry={s.address ? e.retry : undefined} />
          {!s.address && <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => s.connect("creator").then(e.retry).catch(() => {})}>Connect as a creator</button>}
        </div>
      )}

      {data && <CreatorHead />}

      {data && (
        <div className="cols flip">
          <div className="stack-lg">
            <section className="stack" aria-labelledby="set">
              <div className="section-title" style={{ marginBottom: 0 }}><h2 id="set">Settlements</h2></div>
              {rows.length === 0 ? (
                <Empty title="Nothing settled yet.">Get a clip approved and the first entry lands the next time views are reported.</Empty>
              ) : (
                <div className="ledger-wrap">
                  <table className="ledger reflow">
                    <caption className="sr">Settlement entries</caption>
                    <thead><tr><th scope="col">Day</th><th scope="col">Campaign</th><th scope="col" className="n">USDC</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="lead-cell"><b>{r.day}</b></td>
                          <td data-l="Campaign">{r.campaign}</td>
                          <td className="n" data-l="USDC">{money(r.amount)}</td>
                          <td data-l="Status">{r.claimed ? <span className="micro">Claimed{r.tx ? ` · ${r.tx.slice(0, 10)}…` : ""}</span> : r.frozen ? <span className="tag" title={r.frozenReason ?? undefined}>Frozen, in review</span> : r.releaseAt && new Date(r.releaseAt).getTime() > now ? <span className="tag">Releases {new Date(r.releaseAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : <span className="tag solid">Open</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td colSpan={2}>Total settled</td><td className="n">{money(open.reduce((a, r) => a + owed(r), 0) + claimedTotal)}</td><td /></tr></tfoot>
                  </table>
                </div>
              )}
            </section>

            <section className="stack" aria-labelledby="est">
              <div className="section-title" style={{ marginBottom: 0 }}><h2 id="est">Still earning</h2><span className="micro">Estimates, before fees</span></div>
              {data.estimates.length === 0 ? (
                <Empty title="No campaigns yet.">Submit a clip to a campaign and it shows up here.</Empty>
              ) : (
                <div className="ledger-wrap">
                  <table className="ledger reflow">
                    <caption className="sr">Estimated earnings per campaign</caption>
                    <thead><tr><th scope="col">Campaign</th><th scope="col" className="n">Approved clips</th><th scope="col" className="n">Views</th><th scope="col" className="n">Est. USDC</th></tr></thead>
                    <tbody>
                      {data.estimates.map((r) => (
                        <tr key={r.campaignId}>
                          <td className="lead-cell"><b>{r.title}</b><span className="sub">{MODE_LABEL[r.mode]}</span></td>
                          <td className="n" data-l="Approved clips">{r.approvedClips}</td>
                          <td className="n" data-l="Views">{whole(r.views)}</td>
                          <td className="n" data-l="Est. USDC">{r.est === null ? "set by split" : money(r.est)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <MySubmissions />
          </div>

          <aside className="rail" aria-label="Claim">
            <span className="micro">Claimable now</span>
            <div className="fig-xl" aria-live="polite">{money(claimable)}<span className="micro" style={{ marginLeft: 8 }}>USDC</span></div>
            <dl className="kv"><dt>Open entries</dt><dd>{open.length}</dd><dt>Already claimed</dt><dd>{money(claimedTotal)}</dd>{frozenTotal > 0 && <><dt>Frozen, in review</dt><dd>{money(frozenTotal)}</dd></>}</dl>
            {!s.address ? (
              <button className="btn" disabled={s.connecting} onClick={() => s.connect("creator").catch(() => {})}>{s.connecting ? "Check your wallet" : "Connect wallet to claim"}</button>
            ) : (
              <button className="btn" disabled={busy || ready.length === 0 || unconfigured} onClick={() => claim(ready.map((r) => r.id))}>
                <Coins size={18} /> {busy ? "Waiting for signature" : ready.length ? `Claim ${money(claimable)} USDC` : "Nothing to claim"}
              </button>
            )}
            {unconfigured && <p className="notice warn" role="alert"><b>Escrow is not configured on this deployment.</b>Claims are switched off until the contract address is set.</p>}
            {claimable > 0 && <FeePreview kind="claim" amount={claimable} />}
            {err && <Correction what={err} onRetry={ready.length ? () => claim(ready.map((r) => r.id)) : undefined} />}
            {txs.length > 0 && <p className="notice" role="status"><b>Claimed and verified on-chain.</b>{txs.map((t) => <span key={t} className="fig" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>tx {t}</span>)}</p>}
            <p className="muted" style={{ fontSize: "0.8rem" }}>Claims are separate per campaign, so one failed transfer never blocks the others. Pay-per-view credits unlock after a {data.fees?.retentionDays ?? 7}-day review window.</p>
            <ModuleLinks />
          </aside>
        </div>
      )}
    </div>
  );
}
