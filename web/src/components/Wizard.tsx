"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Arrow } from "./Icons";
import { money } from "./format";
import { actions, errText, type Suggest } from "./api";
import { useSession } from "./hooks";
import { EMPTY_SOURCE, SourceStep, sourceReady, sourceUrl, type SourceState } from "./SourceStep";

type Content = "upload" | "link" | "generate";
type Pay = "per_view" | "human_split" | "pool_share";
type Sug = Suggest["suggestions"][number];
type S = {
  idea: string;
  title: string;
  summary: string;
  topic: string;
  required: string;
  prohibited: string;
  disclosure: string;
  attribution: string;
  sugg: Sug[];
  content: Content | "";
  contentDetail: string;
  platforms: string[];
  pay: Pay | "";
  shareBy: "views" | "approved_clips" | "";
  approver: "me" | "me_and_admin" | "";
  pool: number;
  rate: number;
  target: number;
  access: "anyone" | "ranked" | "";
  src: SourceState;
};

const INIT: S = { idea: "", title: "", summary: "", topic: "", required: "", prohibited: "", disclosure: "", attribution: "", sugg: [], content: "", contentDetail: "", platforms: [], pay: "", shareBy: "", approver: "", pool: 0, rate: 0, target: 0, access: "", src: EMPTY_SOURCE };

type StepId = "idea" | "story" | "content" | "platforms" | "pay" | "shareBy" | "approver" | "size" | "access" | "review";

function stepsFor(s: S): StepId[] {
  const out: StepId[] = ["idea", "story", "content", "platforms", "pay"];
  if (s.pay === "pool_share") out.push("shareBy");
  if (s.pay === "human_split") out.push("approver");
  out.push("size", "access", "review");
  return out;
}

function Ticket({ type, name, value, checked, onChange, idx, title, desc }: { type: "radio" | "checkbox"; name: string; value: string; checked: boolean; onChange: () => void; idx: string; title: string; desc: string }) {
  return (
    <label className="ticket">
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} />
      <span className="ticket-body">
        <span className="idx">{idx}</span>
        <b>{title}</b>
        <span className="d">{desc}</span>
      </span>
    </label>
  );
}

export function Wizard() {
  const router = useRouter();
  const [s, setS] = useState<S>(INIT);
  const [i, setI] = useState(0);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState("");
  const session = useSession();
  const head = useRef<HTMLLegendElement>(null);
  const created = useRef<string | null>(null);
  const steps = useMemo(() => stepsFor(s), [s]);
  const id = steps[Math.min(i, steps.length - 1)];

  useEffect(() => {
    head.current?.focus();
  }, [id]);

  const set = (p: Partial<S>) => setS((x) => ({ ...x, ...p }));
  const setSrc = useCallback((p: Partial<SourceState>) => setS((x) => ({ ...x, src: { ...x.src, ...p } })), []);

  const valid: Record<StepId, boolean> = {
    idea: s.idea.trim().length >= 12,
    story: s.summary.trim().length >= 20 && s.required.trim().length > 0 && s.disclosure.trim().length > 0,
    content: !!s.content && sourceReady(s.content, s.contentDetail, s.src),
    platforms: s.platforms.length > 0,
    pay: !!s.pay,
    shareBy: !!s.shareBy,
    approver: !!s.approver,
    size: s.pool > 0 && s.target > 0 && (s.pay !== "per_view" || s.rate > 0),
    access: !!s.access,
    review: true,
  };

  const lines = (x: string) => x.split("\n").map((l) => l.trim()).filter(Boolean);
  const upper = (x: string) => x.toUpperCase();

  async function next() {
    setErr("");
    try {
      if (id === "idea" && !s.summary) {
        setWriting(true);
        const r = await actions.suggest({ idea: s.idea });
        set({
          title: r.title,
          topic: r.story.topic,
          summary: r.story.description || r.story.summary,
          required: r.story.requiredPoints.join("\n"),
          prohibited: r.story.prohibitedClaims.join("\n"),
          disclosure: r.story.disclosureLabel,
          attribution: r.story.attribution,
        });
        setWriting(false);
      }
      if (steps[i + 1] === "size") {
        setWriting(true);
        const r = await actions.suggest({ idea: s.idea, payoutMode: upper(s.pay), poolShareBasis: s.shareBy ? upper(s.shareBy) : undefined });
        set({ sugg: r.suggestions });
        setWriting(false);
      }
      if (id === "review") {
        setWriting(true);
        if (!session.user) await session.connect("campaigner");
        /* A retry after a failed source attach must not create a second draft. */
        const cid = created.current ?? await actions.createCampaign({
          title: s.title || s.idea.slice(0, 60),
          story: {
            summary: s.summary.split("\n")[0].slice(0, 300),
            description: s.summary,
            topic: s.topic || "Campaign",
            requiredPoints: lines(s.required),
            prohibitedClaims: lines(s.prohibited),
            disclosureLabel: s.disclosure,
            attribution: s.attribution || "Credit the source",
          },
          contentSource: s.content === "upload" ? "UPLOAD" : s.content === "link" ? "LINK" : "AI_GENERATED",
          contentUrl: s.content === "link" ? sourceUrl(s.content, s.contentDetail, s.src) : undefined,
          platforms: s.platforms.map(upper),
          payoutMode: upper(s.pay) as "PER_VIEW" | "HUMAN_SPLIT" | "POOL_SHARE",
          poolShareBasis: s.shareBy ? (upper(s.shareBy) as "VIEWS" | "APPROVED_CLIPS") : undefined,
          approver: s.approver === "me" ? "CAMPAIGNER_ONLY" : s.approver === "me_and_admin" ? "CAMPAIGNER_AND_ADMIN" : undefined,
          poolSize: s.pool,
          ratePer1k: s.pay === "per_view" ? s.rate : undefined,
          viewTarget: s.target,
          eligibility: s.access === "ranked" ? "HIGHER_RANKED" : "ANYONE_VERIFIED",
        });
        created.current = cid;
        /* The source is attached through its own endpoint: an uploaded file, or an AI video the campaigner approved. */
        if (s.content === "upload" && s.src.file?.uploadId) await actions.setSource(cid, { uploadId: s.src.file.uploadId });
        else if (s.content === "generate" && s.src.job) await actions.setSource(cid, { jobId: s.src.job.id });
        router.push(`/desk/${cid}/fund?pool=${s.pool}&mode=${s.pay}`);
        return;
      }
      setI((x) => x + 1);
    } catch (e) {
      setErr(errText(e));
      setWriting(false);
    }
  }

  const Q: Record<StepId, string> = {
    idea: "What are you promoting?",
    story: "Here is the story. Edit anything.",
    content: "What content should creators use?",
    platforms: "Where should clips be posted?",
    pay: "How should creators be paid?",
    shareBy: "Share the pool by what?",
    approver: "Who approves the split?",
    size: "How big is the pool?",
    access: "Who can join?",
    review: "Check it, then fund it.",
  };

  return (
    <div className="wizard">
      <aside className="rail" aria-label="Progress">
        <span className="micro">Question {Math.min(i + 1, steps.length)} of {steps.length}</span>
        <ol className="progress-steps" aria-hidden="true">
          {steps.map((st, k) => (
            <li key={st} data-s={k < i ? "done" : k === i ? "now" : ""} />
          ))}
        </ol>
        {s.idea && <p className="note"><span className="micro">Promoting</span>{s.idea.slice(0, 90)}{s.idea.length > 90 ? "…" : ""}</p>}
      </aside>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid[id] && !writing) next();
        }}
        noValidate
      >
        <fieldset key={id}>
          <legend ref={head} tabIndex={-1}>
            <span className="micro q-no">Q{String(i + 1).padStart(2, "0")}</span>
            {Q[id]}
          </legend>

          {id === "idea" && (
            <div className="field">
              <label htmlFor="idea">One or two sentences. The agent turns it into a full brief.</label>
              <textarea id="idea" value={s.idea} onChange={(e) => set({ idea: e.target.value, summary: "" })} placeholder="Accounting software that closes the month in three minutes." />
              <span className="hint">{s.idea.trim().length < 12 ? "A few more words, please." : "Good. Next, the agent writes the brief."}</span>
            </div>
          )}

          {id === "story" && (
            <>
              <div className="field">
                <label htmlFor="title">Campaign title</label>
                <input id="title" value={s.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="sum">What creators should make</label>
                <textarea id="sum" value={s.summary} onChange={(e) => set({ summary: e.target.value })} />
              </div>
              <div className="two">
                <div className="field">
                  <label htmlFor="req">Must say, one per line</label>
                  <textarea id="req" value={s.required} onChange={(e) => set({ required: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="pro">Must not say, one per line</label>
                  <textarea id="pro" value={s.prohibited} onChange={(e) => set({ prohibited: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="dis">Disclosure label</label>
                <input id="dis" value={s.disclosure} onChange={(e) => set({ disclosure: e.target.value })} />
                <span className="hint">The agent checks every clip against these four things. Edit until they say what you mean.</span>
              </div>
            </>
          )}

          {id === "content" && (
            <>
              <div className="tickets" role="radiogroup" aria-label="Content source">
                <Ticket type="radio" name="content" value="upload" idx="A" title="Upload a clip" desc="Creators cut from your original file. They can play and download it." checked={s.content === "upload"} onChange={() => set({ content: "upload", contentDetail: "", src: EMPTY_SOURCE })} />
                <Ticket type="radio" name="content" value="link" idx="B" title="Link a video" desc="Point at a video you already host." checked={s.content === "link"} onChange={() => set({ content: "link", contentDetail: "", src: EMPTY_SOURCE })} />
                <Ticket type="radio" name="content" value="generate" idx="C" title="Generate one" desc="Describe it. Clippo makes an AI video, labelled as AI-generated." checked={s.content === "generate"} onChange={() => set({ content: "generate", contentDetail: "", src: EMPTY_SOURCE })} />
              </div>
              {s.content && <SourceStep kind={s.content} detail={s.contentDetail} setDetail={(v) => set({ contentDetail: v })} src={s.src} setSrc={setSrc} />}
            </>
          )}

          {id === "platforms" && (
            <>
              <div className="tickets" role="group" aria-label="Platforms, choose one or more">
                {[["youtube", "YouTube", "Built first. Transcript and views read automatically."], ["x", "X", "Second. Unreadable posts go to a person."], ["instagram", "Instagram", "Third. Unreadable posts go to a person."]].map(([v, t, d], k) => (
                  <Ticket key={v} type="checkbox" name="plat" value={v} idx={"ABC"[k]} title={t} desc={d} checked={s.platforms.includes(v)} onChange={() => set({ platforms: s.platforms.includes(v) ? s.platforms.filter((x) => x !== v) : [...s.platforms, v] })} />
                ))}
              </div>
              <span className="hint">Choose one or more.</span>
            </>
          )}

          {id === "pay" && (
            <div className="tickets" role="radiogroup" aria-label="Payout rule">
              <Ticket type="radio" name="pay" value="per_view" idx="A" title="Per view" desc="A fixed rate per 1,000 verified views, until the pool runs out." checked={s.pay === "per_view"} onChange={() => set({ pay: "per_view", shareBy: "", approver: "" })} />
              <Ticket type="radio" name="pay" value="human_split" idx="B" title="I approve the split" desc="The agent pre-scores. You approve the final split with a fresh World ID check." checked={s.pay === "human_split"} onChange={() => set({ pay: "human_split", shareBy: "" })} />
              <Ticket type="radio" name="pay" value="pool_share" idx="C" title="Share the whole pool" desc="Divided at the end by each creator’s share. Every dollar gets spent." checked={s.pay === "pool_share"} onChange={() => set({ pay: "pool_share", approver: "" })} />
            </div>
          )}

          {id === "shareBy" && (
            <div className="tickets" role="radiogroup" aria-label="Share by">
              <Ticket type="radio" name="sb" value="views" idx="A" title="Views" desc="Each creator gets their share of all verified views." checked={s.shareBy === "views"} onChange={() => set({ shareBy: "views" })} />
              <Ticket type="radio" name="sb" value="approved_clips" idx="B" title="Approved clips" desc="Each creator gets their share of all approved clips." checked={s.shareBy === "approved_clips"} onChange={() => set({ shareBy: "approved_clips" })} />
            </div>
          )}

          {id === "approver" && (
            <div className="tickets" role="radiogroup" aria-label="Approver">
              <Ticket type="radio" name="ap" value="me" idx="A" title="Only me" desc="One World ID check from you releases the split." checked={s.approver === "me"} onChange={() => set({ approver: "me" })} />
              <Ticket type="radio" name="ap" value="me_and_admin" idx="B" title="Me and an admin" desc="Two people sign before money moves." checked={s.approver === "me_and_admin"} onChange={() => set({ approver: "me_and_admin" })} />
            </div>
          )}

          {id === "size" && (
            <>
              <div className="stack">
                <span className="micro">Agent suggestions for this kind of campaign</span>
                <div className="suggest" role="group" aria-label="Suggested sizes">
                  {s.sugg.map((o) => (
                    <button type="button" key={o.label} className="ticket-body" style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} aria-pressed={s.pool === o.poolSize} onClick={() => set({ pool: o.poolSize, rate: o.ratePer1k ?? 0, target: o.viewTarget })}>
                      <span className="idx">{o.label}</span>
                      <b className="fig" style={{ fontFamily: "var(--f-mono)", fontSize: "1.5rem" }}>${money(o.poolSize, 0)}</b>
                      <span className="d">{o.ratePer1k ? `$${money(o.ratePer1k)} per 1K · ` : ""}target {(o.viewTarget / 1000).toLocaleString()}K views</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="two">
                <div className="field"><label htmlFor="pool">Pool</label><div className="unit"><input id="pool" type="number" min={0} step={100} value={s.pool || ""} onChange={(e) => set({ pool: Number(e.target.value) })} /><span>USDC</span></div></div>
                {s.pay === "per_view" && <div className="field"><label htmlFor="rate">Rate</label><div className="unit"><input id="rate" type="number" min={0} step={0.1} value={s.rate || ""} onChange={(e) => set({ rate: Number(e.target.value) })} /><span>USDC / 1K views</span></div></div>}
                <div className="field"><label htmlFor="tg">View target</label><div className="unit"><input id="tg" type="number" min={0} step={10000} value={s.target || ""} onChange={(e) => set({ target: Number(e.target.value) })} /><span>views</span></div></div>
              </div>
              {s.pay === "per_view" && s.pool > 0 && s.rate > 0 && (
                <p className="note"><span className="micro">Arithmetic</span>${money(s.pool, 0)} at ${money(s.rate)} per 1K covers {Math.round((s.pool / s.rate) * 1000).toLocaleString()} views, before fees.</p>
              )}
            </>
          )}

          {id === "access" && (
            <div className="tickets" role="radiogroup" aria-label="Who can join">
              <Ticket type="radio" name="ac" value="anyone" idx="A" title="Anyone verified" desc="Every World ID-verified creator can join." checked={s.access === "anyone"} onChange={() => set({ access: "anyone" })} />
              <Ticket type="radio" name="ac" value="ranked" idx="B" title="Higher-ranked only" desc="Creators with a track record of approved clips." checked={s.access === "ranked"} onChange={() => set({ access: "ranked" })} />
            </div>
          )}

          {id === "review" && (
            <dl className="kv" style={{ maxWidth: 560 }}>
              <dt>Promoting</dt><dd>{s.idea.slice(0, 60)}</dd>
              <dt>Content</dt><dd>{s.content === "generate" ? "AI-generated video, approved" : s.content === "upload" ? `Upload, ${s.src.file?.name ?? ""}` : "Linked video"}</dd>
              {s.content === "generate" && (<><dt>Label</dt><dd><span className="x-label ai">AI-GENERATED</span></dd></>)}
              <dt>Platforms</dt><dd>{s.platforms.join(", ")}</dd>
              <dt>Payout</dt><dd>{s.pay.replace("_", " ")}{s.shareBy ? `, by ${s.shareBy.replace("_", " ")}` : ""}{s.approver ? `, ${s.approver.replace(/_/g, " ")}` : ""}</dd>
              <dt>Pool</dt><dd>${money(s.pool, 0)} USDC</dd>
              {s.pay === "per_view" && (<><dt>Rate</dt><dd>${money(s.rate)} / 1K</dd></>)}
              <dt>Target</dt><dd>{s.target.toLocaleString()} views</dd>
              <dt>Who</dt><dd>{s.access}</dd>
            </dl>
          )}

          {writing && <p className="mono" role="status">{id === "idea" ? "The agent is writing the brief" : id === "review" ? "Creating the campaign" : "The agent is sizing the pool"}<span className="caret" aria-hidden="true" /></p>}
          {err && <p className="notice warn" role="alert"><b>Stopped.</b>{err}</p>}

          <div className="row" style={{ gap: 20, marginTop: 8 }}>
            {i > 0 && (
              <button type="button" className="btn ghost" onClick={() => setI(i - 1)}>
                Back
              </button>
            )}
            <button className="btn" disabled={!valid[id] || writing}>
              {id === "review" ? "Create and go to funding" : id === "idea" ? "Write the brief" : "Next"} <Arrow size={18} />
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
