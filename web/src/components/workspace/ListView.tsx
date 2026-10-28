"use client";
import { useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAsync } from "../hooks";
import { ws, errText } from "../api";
import { Correction, DemoNote, Empty, Loading, PageHead } from "../Bits";
import { Ad, money, useSelection } from "./parts";

/** Public shortlist: anyone with the link can read it. No sign-in, no edit controls. */
export function ListView() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const sel = useSelection();
  const fn = useCallback(() => ws.list(token), [token]);
  const l = useAsync(fn);

  if (l.status === "loading") return <div className="wrap page"><Loading label="Pulling the list" rows={5} /></div>;
  if (l.status === "error") return <div className="wrap page"><Correction what="The list did not load." fix={errText(l.error)} onRetry={l.retry} /></div>;
  if (!l.data)
    return (
      <div className="wrap page">
        <Empty title="No list at this address." action={<Link href="/hire" className="btn sm">Browse the directory</Link>}>
          The link may be cut short or the list was withdrawn. Ask whoever sent it for a fresh one.
        </Empty>
      </div>
    );

  const list = l.data;
  const rows = list.creators;
  const low = rows.reduce((a, c) => a + c.lowest, 0);

  return (
    <div className="wrap page">
      <PageHead kicker={<><Link href="/hire">Hire</Link><span>Shortlist</span><span>Read only</span></>} title={<>{list.title}</>}>
        {rows.length} creators picked from the directory. Rates are the creators&rsquo; own, in USDC.
      </PageHead>
      <DemoNote />
      <div className="cols flip" style={{ marginTop: 24 }}>
        <section aria-label="Listings">
          {rows.length === 0 ? (
            <Empty title="This list is empty.">Every creator on it has since left the directory.</Empty>
          ) : (
            <ul className="ws-ads">{rows.map((c) => <Ad key={c.id} c={c} />)}</ul>
          )}
        </section>
        <aside className="rail" aria-label="About this list">
          <span className="micro">The arithmetic</span>
          <dl className="kv">
            <dt>Creators</dt><dd>{rows.length}</dd>
            <dt>One cheapest line each</dt><dd>${money(low, 0)}</dd>
          </dl>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            Nothing is held or charged by opening this list. Hiring starts with a written brief and per-creator approval, then one funding step.
          </p>
          <button
            className="btn sm"
            onClick={() => {
              sel.set(rows.map((c) => c.id));
              router.push("/hire/brief");
            }}
          >
            Brief these creators
          </button>
        </aside>
      </div>
    </div>
  );
}
