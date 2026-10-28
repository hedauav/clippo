"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ws, errText } from "../api";
import { Correction, DemoNote, Empty, Loading, PageHead } from "../Bits";
import { Cross } from "../Icons";
import { OBJECTIVE, emptyBrief, type Brief, type DirCreator, type Objective } from "@/ui-mocks/workspace";
import { useAsync, useSession } from "../hooks";
import { money, useSelection } from "./parts";

type Offer = { rateLabel: string; qty: string };
type Errs = Partial<Record<"title" | "brand" | "summary" | "mustSay" | "due" | "cap" | "rate", string>>;

const dir = () => ws.directory();
const priceOf = (c: DirCreator, o: Offer) => (c.rates.find((x) => x.label === o.rateLabel)?.price ?? 0) * (Math.floor(Number(o.qty)) || 0);

function Lines({ label, hint, values, onChange, add }: { label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; add: string }) {
  return (
    <div className="ws-lines" role="group" aria-label={label}>
      <span className="micro">{label}</span>
      {values.map((v, i) => (
        <div className="ln" key={i}>
          <div className="field">
            <input aria-label={`${label}, line ${i + 1}`} value={v} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
          {values.length > 1 && <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1} of ${label}`}>Strike</button>}
        </div>
      ))}
      {hint && <span className="hint muted" style={{ fontSize: "0.8125rem" }}>{hint}</span>}
      <button type="button" className="linkbtn" style={{ justifySelf: "start" }} onClick={() => onChange([...values, ""])}>{add}</button>
    </div>
  );
}

export function BriefBuilder() {
  const sel = useSelection();
  const sess = useSession();
  const isCampaigner = !!sess.address && sess.role === "campaigner";
  const router = useRouter();
  const [b, setB] = useState<Brief>(emptyBrief);
  const [offers, setOffers] = useState<Record<string, Offer>>({});
  const [errs, setErrs] = useState<Errs>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");

  const all = useAsync(dir);
  const picked = useMemo(() => (all.status === "ready" ? sel.ids.map((id) => all.data.find((c) => c.id === id)).filter((c): c is DirCreator => !!c) : []), [all, sel.ids]);
  const offerOf = (c: DirCreator): Offer => offers[c.id] ?? { rateLabel: c.rates[0].label, qty: "1" };
  const total = picked.reduce((a, c) => a + priceOf(c, offerOf(c)), 0);
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setB((x) => ({ ...x, [k]: v }));

  function setOffer(c: DirCreator, patch: Partial<Offer>) {
    setOffers((o) => ({ ...o, [c.id]: { ...offerOf(c), ...patch } }));
  }

  function validate(): Errs {
    const e: Errs = {};
    if (!b.title.trim()) e.title = "Name the campaign. Creators see this first.";
    if (!b.brand.trim()) e.brand = "Say who is paying.";
    if (b.summary.trim().length < 30) e.summary = "Write at least a couple of sentences: what the product is and what the clip must show.";
    if (!b.mustSay.some((x) => x.trim())) e.mustSay = "List at least one thing every clip has to say.";
    if (!b.due) e.due = "Pick a delivery date.";
    else if (new Date(`${b.due}T23:59:59`) < new Date()) e.due = "That date has passed.";
    if (!(b.cap > 0)) e.cap = "Set a budget cap above zero.";
    if (picked.some((c) => !(Math.floor(Number(offerOf(c).qty)) >= 1))) e.rate = "Every creator needs a quantity of at least 1.";
    return e;
  }

  async function submit() {
    const e = validate();
    setErrs(e);
    setFail("");
    if (Object.keys(e).length) {
      document.getElementById("brief-errs")?.focus();
      return;
    }
    setBusy(true);
    try {
      const brief: Brief = { ...b, mustSay: b.mustSay.map((x) => x.trim()).filter(Boolean), mustNot: b.mustNot.map((x) => x.trim()).filter(Boolean) };
      const w = await ws.createWorkspace(brief, picked.map((c) => ({ creatorId: c.id, rateLabel: offerOf(c).rateLabel, quantity: Math.floor(Number(offerOf(c).qty)) })));
      router.push(`/hire/w/${w.id}`);
    } catch (x) {
      setFail(errText(x));
      setBusy(false);
    }
  }

  const bad = (k: keyof Errs) => (errs[k] ? " bad" : "");
  const err = (k: keyof Errs) =>
    errs[k] ? (
      <span className="err row" style={{ gap: 6 }} id={`e-${k}`}>
        <Cross size={14} /> {errs[k]}
      </span>
    ) : null;

  if (all.status === "loading") return <div className="wrap page"><Loading label="Pulling your clipped list" rows={4} /></div>;
  if (all.status === "error") return <div className="wrap page"><Correction what="The directory did not load." fix={errText(all.error)} onRetry={all.retry} /></div>;
  if (picked.length === 0)
    return (
      <div className="wrap page">
        <PageHead kicker={<><Link href="/hire">Hire</Link><span>Brief</span></>} title={<>Write the <em>brief</em></>}>
          A brief needs creators to send it to.
        </PageHead>
        <Empty title="Nobody is clipped yet." action={<Link href="/hire" className="btn sm">Open the directory</Link>}>
          Clip two or three listings first. The brief and the offers are written against that list.
        </Empty>
      </div>
    );

  const overCap = total > b.cap;
  const errCount = Object.keys(errs).length;

  return (
    <div className="wrap page">
      <PageHead kicker={<><Link href="/hire">Hire</Link><span>Brief</span><span>{picked.length} creators</span></>} title={<>Write the <em>brief</em></>}>
        One brief goes to every creator on the list. Each one gets their own rate, and nothing is charged until you approve and fund.
      </PageHead>
      <DemoNote />

      <form className="ws-brief" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errCount > 0 && (
          <div id="brief-errs" tabIndex={-1} className="correction" role="alert">
            <span className="micro">Correction</span>
            <b>{errCount} {errCount === 1 ? "thing needs" : "things need"} fixing before the brief can go out.</b>
            <span>{Object.values(errs).join(" ")}</span>
          </div>
        )}
        {fail && <Correction what="The brief was not saved." fix={fail} onRetry={() => void submit()} />}

        <section aria-labelledby="s1">
          <h2 id="s1"><span className="micro">I</span>The job</h2>
          <div className="two">
            <div className={`field${bad("title")}`}>
              <label htmlFor="bt">Campaign name</label>
              <input id="bt" value={b.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errs.title} aria-describedby="e-title" placeholder="Ledgerlane: the 3-minute close" />
              {err("title")}
            </div>
            <div className={`field${bad("brand")}`}>
              <label htmlFor="bb">Brand</label>
              <input id="bb" value={b.brand} onChange={(e) => set("brand", e.target.value)} aria-invalid={!!errs.brand} aria-describedby="e-brand" placeholder="Ledgerlane" />
              {err("brand")}
            </div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className="micro" style={{ marginBottom: 10 }}>Objective</legend>
            <div className="tickets" role="radiogroup" aria-label="Objective">
              {(Object.keys(OBJECTIVE) as Objective[]).map((k, i) => (
                <label className="ticket" key={k}>
                  <input type="radio" name="obj" checked={b.objective === k} onChange={() => set("objective", k)} />
                  <span className="ticket-body">
                    <span className="idx">{"ABC"[i]}</span>
                    <b>{OBJECTIVE[k].t}</b>
                    <span className="d">{OBJECTIVE[k].d}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={`field${bad("summary")}`}>
            <label htmlFor="bs">What the clip is about</label>
            <textarea id="bs" value={b.summary} onChange={(e) => set("summary", e.target.value)} aria-invalid={!!errs.summary} aria-describedby="h-s e-summary" />
            <span className="hint" id="h-s">Plain sentences. The agent that checks each clip reads exactly this.</span>
            {err("summary")}
          </div>
        </section>

        <section aria-labelledby="s2">
          <h2 id="s2"><span className="micro">II</span>The rules</h2>
          <div className={`field${bad("mustSay")}`}>
            <Lines label="Every clip must say" values={b.mustSay} onChange={(v) => set("mustSay", v)} add="Add a line" hint="Short and checkable, such as: Names the product in the first 10 seconds." />
            {err("mustSay")}
          </div>
          <Lines label="No clip may say" values={b.mustNot} onChange={(v) => set("mustNot", v)} add="Add a line" hint="Claims you will not stand behind. Leave blank if there are none." />
          <div className="field">
            <label htmlFor="bd">Disclosure label</label>
            <input id="bd" value={b.disclosure} onChange={(e) => set("disclosure", e.target.value)} />
            <span className="hint">Required wording, and where it has to appear.</span>
          </div>
          <div className="two">
            <div className={`field${bad("due")}`}>
              <label htmlFor="bdue">Delivery date</label>
              <input id="bdue" type="date" value={b.due} onChange={(e) => set("due", e.target.value)} aria-invalid={!!errs.due} aria-describedby="e-due" />
              {err("due")}
            </div>
            <div className={`field${bad("cap")}`}>
              <label htmlFor="bc">Budget cap, USDC</label>
              <input id="bc" type="number" min={1} step={50} value={b.cap || ""} onChange={(e) => set("cap", Number(e.target.value))} aria-invalid={!!errs.cap} aria-describedby="e-cap" />
              <span className="hint">You cannot approve more than this in total.</span>
              {err("cap")}
            </div>
          </div>
        </section>

        <section aria-labelledby="s3">
          <h2 id="s3"><span className="micro">III</span>The offers</h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>Rates are the creators&rsquo; own. You pick a line from each card and a quantity. You cannot haggle the price down here.</p>
          <div className="ws-offers">
            {picked.map((c) => {
              const o = offerOf(c);
              return (
                <div className="ws-offer" key={c.id}>
                  <div className="who">
                    <b>{c.name}</b>
                    <span className="micro">No. {c.serial} · {c.tier}</span>
                  </div>
                  <div className="field">
                    <label htmlFor={`d-${c.id}`}>Rate line, set by the creator</label>
                    <select id={`d-${c.id}`} value={o.rateLabel} onChange={(e) => setOffer(c, { rateLabel: e.target.value })}>
                      {c.rates.map((r) => (
                        <option key={r.label} value={r.label}>{r.label}, ${money(r.price, 0)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`r-${c.id}`}>Quantity</label>
                    <div className="amt">
                      <input id={`r-${c.id}`} inputMode="numeric" value={o.qty} onChange={(e) => setOffer(c, { qty: e.target.value.replace(/D/g, "") })} aria-describedby={`c-${c.id}`} />
                    </div>
                    <span className="hint fig" id={`c-${c.id}`} style={{ fontSize: "0.72rem" }}>= ${money(priceOf(c, o), 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {err("rate")}
          <div className="ws-sum" role="status" aria-live="polite">
            <span className="micro">Offered, all creators</span>
            <span className="fig-xl" style={{ fontSize: "2.2rem", color: overCap ? "var(--no)" : undefined }}>${money(total, 0)}</span>
          </div>
          <p className={overCap ? "err" : "muted"} style={overCap ? { color: "var(--no)", fontWeight: 700 } : undefined}>
            {overCap ? `Offers add up to $${money(total - b.cap, 0)} more than your $${money(b.cap, 0)} cap. You can still send them. You will not be able to approve all of them.` : `$${money(b.cap - total, 0)} of the $${money(b.cap, 0)} cap is unspoken for.`}
          </p>
        </section>

        <div className="row" style={{ gap: 24 }}>
          {isCampaigner ? (
            <button className="btn" type="submit" disabled={busy}>{busy ? "Setting type" : `Send to ${picked.length} creators`}</button>
          ) : (
            <div className="notice">
              <b>Briefs are sent from a campaigner wallet.</b>
              <button type="button" className="btn sm" style={{ justifySelf: "start", marginTop: 6 }} onClick={() => sess.connect("campaigner").catch(() => {})}>Connect campaigner wallet</button>
            </div>
          )}
          <Link href="/hire" className="linkbtn">Back to the directory</Link>
        </div>
      </form>
    </div>
  );
}
