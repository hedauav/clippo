"use client";
import "./workspace.css";
import { useSyncExternalStore } from "react";
import { Check, Scissors, PlatformGlyph } from "../Icons";
import { money, whole } from "../format";
import { STAGES, STAGE_LABEL, TIER_LABEL, type DirCreator, type Stage } from "@/ui-mocks/workspace";
import { selection } from "./mockStore";

const empty: string[] = [];
let cache: { raw: string; val: string[] } = { raw: "[]", val: empty };
function snap() {
  let raw = "[]";
  try {
    raw = localStorage.getItem("clippo-ws-sel") ?? "[]";
  } catch {
    /* blocked */
  }
  if (raw !== cache.raw) {
    let val: string[] = empty;
    try {
      val = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    cache = { raw, val };
  }
  return cache.val;
}
/** The clipped tray: ids of creators the campaigner has cut out. Shared across pages via localStorage. */
export function useSelection() {
  const ids = useSyncExternalStore(selection.subscribe, snap, () => empty);
  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle: (id: string) => selection.set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
    remove: (id: string) => selection.set(ids.filter((x) => x !== id)),
    set: (next: string[]) => selection.set(next),
  };
}

export const TierMark = ({ tier }: { tier: DirCreator["tier"] }) => <span className={`tier-mark ${tier.toLowerCase()}`}>{TIER_LABEL[tier]}</span>;

/** A rate card set in classified-ad style. `onClip` omitted = read-only listing. */
export function Ad({ c, clipped, onClip }: { c: DirCreator; clipped?: boolean; onClip?: () => void }) {
  return (
    <li className={`ad t-${c.tier.toLowerCase()}${clipped ? " is-clipped" : ""}`}>
      <div className="ad-lead">
        <span className="micro">For hire</span>
        <span className="micro">No. {c.serial}</span>
      </div>
      <h3>{c.name}</h3>
      <div className="row" style={{ gap: 10 }}>
        <TierMark tier={c.tier} />
        {c.niches.slice(0, 2).map((n) => <span className="niche" key={n}>{n}</span>)}
        <span className="row" style={{ gap: 5 }}>
          {c.platforms.map((p) => (
            <PlatformGlyph key={p} p={p} />
          ))}
        </span>
      </div>
      {c.bio && <p className="blurb">{c.bio}</p>}
      <ul className="rates" aria-label={`Rates for ${c.name}, USDC per deliverable`}>
        {c.rates.map((r) => (
          <li key={r.label}>
            <span>{r.label}</span>
            <span>${money(r.price, 0)}</span>
          </li>
        ))}
      </ul>
      <p className="facts">
        <span>{c.approvedClips} approved clips</span>
        <span>{c.approvedClips ? `${Math.round(c.reliability * 100)}% pass` : "no clips judged yet"}</span>
        {c.verified && <span>World ID verified</span>}
      </p>
      {onClip && (
        <div className="ad-foot">
          <button className="clip-btn" onClick={onClip} aria-pressed={!!clipped} aria-label={`${clipped ? "Remove" : "Clip"} ${c.name} ${clipped ? "from" : "to"} the shortlist`}>
            {clipped ? <Check size={16} /> : <Scissors size={16} />}
            {clipped ? "Clipped" : "Clip this ad"}
          </button>
          <span className="micro">USDC, set by the creator</span>
        </div>
      )}
    </li>
  );
}

export function StageTrack({ stage }: { stage: Stage }) {
  const at = stage === "awaiting" ? -1 : STAGES.indexOf(stage);
  return (
    <div>
      <div className="track" role="img" aria-label={`Stage: ${STAGE_LABEL[stage]}`}>
        {STAGES.map((s, i) => (
          <i key={s} className={i < at ? "on" : i === at ? "now" : ""} />
        ))}
      </div>
      <div className="track-labels" aria-hidden="true">
        {STAGES.map((s) => (
          <span key={s}>{STAGE_LABEL[s]}</span>
        ))}
      </div>
    </div>
  );
}

export const fmtDate = (iso: string) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "no date set");
export { money, whole };
