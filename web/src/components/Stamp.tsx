import type { Verdict } from "@/ui-mocks/data";

/** One shared SVG filter: the slight ink-bleed on stamps. Rendered once in the root layout. */
export function InkFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
      </filter>
    </svg>
  );
}

const LABEL: Record<Verdict, string> = {
  approved: "Approved",
  rejected: "Rejected",
  needs_human: "Needs human",
  pending: "In the queue",
};
const CLS: Record<Verdict, string> = { approved: "ok", rejected: "no", needs_human: "hold", pending: "pending" };

export function Stamp({ verdict, conf, xl }: { verdict: Verdict; conf?: number; xl?: boolean }) {
  return (
    <span className={`stamp ${CLS[verdict]}${xl ? " xl" : ""}`} role="status" aria-label={`Verdict: ${LABEL[verdict]}${conf ? `, confidence ${conf}` : ""}`}>
      {LABEL[verdict]}
      {conf ? <small>CONF {conf.toFixed(2)}</small> : null}
    </span>
  );
}
