import type { TierName } from "@/ui-mocks/market";
import { VerifiedMark } from "./Icons";
import "./market.css";

/* Two tier vocabularies exist server-side (marketplace NEW/RISING/PRO/ELITE, status ladder VERIFIED/RISING/PARTNER/TOP).
   Both map to the same four rungs, so one mark serves both. */
const LEVEL: Record<TierName, number> = { NEW: 0, VERIFIED: 0, RISING: 1, PRO: 2, PARTNER: 2, ELITE: 3, TOP: 3 };
const LABEL: Record<TierName, string> = { NEW: "New", VERIFIED: "Verified", RISING: "Rising", PRO: "Pro", PARTNER: "Partner", ELITE: "Elite", TOP: "Top" };

export const tierLevel = (t: TierName | null | undefined) => (t ? LEVEL[t] ?? 0 : 0);
export const tierLabel = (t: string) => LABEL[t as TierName] ?? t;

/** Rungs drawn as nested chevrons, nudged off-grid. Level 0 is a single short rule, not a chevron. */
function Rungs({ level }: { level: number }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
      {level === 0 ? (
        <path d="M2.2 6.3h7.5" />
      ) : (
        Array.from({ length: level }, (_, i) => <path key={i} d={`M1.8 ${9.6 - i * 3.1}l4.3-3 4.2 3`} />)
      )}
    </svg>
  );
}

export function TierMark({ tier }: { tier: TierName | null | undefined }) {
  if (!tier) return null;
  const level = tierLevel(tier);
  return (
    <span className="tier" data-t={level + 1} title={`Tier: ${LABEL[tier]}`}>
      <Rungs level={level} />
      {LABEL[tier]}
    </span>
  );
}

/** A creator's name with the verified mark and tier, in the order a byline reads. */
export function Byline({ name, verified, tier }: { name: string; verified?: boolean; tier?: TierName | null }) {
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <span className="handle fig" style={{ letterSpacing: 0 }}>{name}</span>
      {verified && <VerifiedMark size={14} />}
      <TierMark tier={tier} />
    </span>
  );
}
