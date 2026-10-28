import type { ReactNode, SVGProps } from "react";

/* Hand-inked icon set: 24px grid, 1.5 stroke, square caps, mitre joins, endpoints nudged off-grid on purpose. */
type P = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Base({ size = 20, title, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Scissors = (p: P) => (
  <Base {...p}>
    <path d="M3.2 5.4 20.6 18.9M3.4 18.7 20.8 5.2" />
    <path d="M3 4.6l3.6.2.3 3.4-3.5-.3z" />
    <path d="M3.1 15.9l3.5-.4.3 3.6-3.6.2z" />
  </Base>
);
export const Link = (p: P) => (
  <Base {...p}>
    <path d="M10 14.2 14.3 9.9" />
    <path d="M8.6 11.2 5.9 13.9a3.2 3.2 0 0 0 4.5 4.6l2.6-2.7" />
    <path d="M15.4 12.8l2.7-2.7a3.2 3.2 0 0 0-4.5-4.6l-2.6 2.7" />
  </Base>
);
export const Check = (p: P) => (
  <Base {...p}>
    <path d="M4 12.8 9.4 18.2 20.2 5.6" />
    <path d="M4.6 12.2l5 5" opacity=".5" />
  </Base>
);
export const Cross = (p: P) => (
  <Base {...p}>
    <path d="M5 5.4 19 18.8M19.2 5 4.8 19" />
  </Base>
);
export const Flag = (p: P) => (
  <Base {...p}>
    <path d="M5.5 21V3.4" />
    <path d="M5.5 4.2c4-2 6 2 13.2-.2l-2.1 4.6 2.1 4.8c-7.2 2.2-9.2-1.8-13.2.2" />
  </Base>
);
export const Coins = (p: P) => (
  <Base {...p}>
    <ellipse cx="12" cy="6.4" rx="7.4" ry="2.9" />
    <path d="M4.6 6.6v5.2c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9V6.4" />
    <path d="M4.6 11.8v5.2c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9v-5" />
  </Base>
);
export const Bracket = (p: P) => (
  <Base {...p}>
    <path d="M15.4 3.6H8.6v16.8h6.8" />
  </Base>
);
export const ArrowCorner = (p: P) => (
  <Base {...p}>
    <path d="M6.4 17.6 17.4 6.6" />
    <path d="M8.4 6.4h9.2v9.4" />
  </Base>
);
export const Arrow = (p: P) => (
  <Base {...p}>
    <path d="M3.6 12.2h16.6" />
    <path d="M14.2 6.2l6 6-6 6" />
  </Base>
);
export const Eye = (p: P) => (
  <Base {...p}>
    <path d="M2.6 12.2C5.4 7.6 8.6 6 12 6s6.6 1.6 9.4 6.2c-2.8 4.6-6 6.2-9.4 6.2s-6.6-1.6-9.4-6.2z" />
    <circle cx="12" cy="12.2" r="2.9" />
  </Base>
);
export const Clock = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 6.8V12.4l3.8 2.4" />
  </Base>
);
export const Notch = (p: P) => (
  <Base {...p}>
    <path d="M3.4 3.6h17.2v6.6a2.3 2.3 0 0 0 0 3.6v6.6H3.4v-6.6a2.3 2.3 0 0 0 0-3.6z" />
  </Base>
);
export const Upload = (p: P) => (
  <Base {...p}>
    <path d="M12 16.6V4.4M6.6 9.6 12 4.2l5.4 5.4" />
    <path d="M3.8 17.4v3h16.4v-3" />
  </Base>
);
export const Play = (p: P) => (
  <Base {...p}>
    <path d="M6.6 4.6 19 12 6.6 19.6z" />
  </Base>
);
export const Wand = (p: P) => (
  <Base {...p}>
    <path d="M4 20 16.4 7.6" />
    <path d="M15 4.4l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" />
  </Base>
);
export const Wallet = (p: P) => (
  <Base {...p}>
    <path d="M3.6 6.4h15.8v13H3.6z" />
    <path d="M3.6 6.4 16 3.6v2.8" />
    <path d="M14.4 12.6h5v3.4h-5z" />
  </Base>
);

/* Verified: a rosette of four crossed strokes, not a tick-in-a-circle. */
export function VerifiedMark({ size = 16 }: { size?: number }) {
  return (
    <span className="vbadge" title="Verified human">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Verified human">
        <path d="M12 1.6 14.6 5l4.2-.6.7 4.2 3.9 1.9-2.2 3.6 1.5 4-4.2.5-1.9 3.9L12 20.4l-3.8 2.1-1.9-3.9-4.2-.5 1.5-4L1.4 10.5l3.9-1.9.7-4.2L10.2 5z" />
        <path d="M7.6 12.2l3.2 3.3 5.8-6.4" stroke="var(--signal-ink)" strokeWidth="2" fill="none" />
      </svg>
    </span>
  );
}

/* Wordmark glyph: two blades crossing, the slit between them is the "clip". */
export function Blades() {
  return (
    <svg viewBox="0 0 34 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
      <path d="M1 2.4 28 19.4" />
      <path d="M1 19.6 28 2.6" />
      <path d="M30 6.6h3.4M30 15.4h3.4" stroke="var(--signal)" />
    </svg>
  );
}

export function PlatformGlyph({ p }: { p: "youtube" | "x" | "instagram" }) {
  const label = p === "youtube" ? "YT" : p === "x" ? "X" : "IG";
  return (
    <span className="tag" title={p} aria-label={p}>
      {label}
    </span>
  );
}
