"use client";
import { useEffect, useRef } from "react";
import { LoopClip, type ClipId } from "@/components/LoopClip";

type Tile = { n: number; who: string; len: string };
const ROWS: Tile[][] = [
  [
    { n: 1, who: "@duskpilot", len: "0:04" },
    { n: 2, who: "@numbers.nina", len: "0:04" },
    { n: 3, who: "@kiln.and.keys", len: "0:04" },
    { n: 4, who: "@tidal.tom", len: "0:04" },
    { n: 5, who: "@ninthward", len: "0:04" },
    { n: 6, who: "@hexbolt.fan", len: "0:04" },
    { n: 7, who: "@fieldnotes", len: "0:04" },
    { n: 8, who: "@loop.lena", len: "0:04" },
  ],
  [
    { n: 9, who: "@cutroom", len: "0:04" },
    { n: 10, who: "@bank.feed", len: "0:04" },
    { n: 11, who: "@closeday", len: "0:04" },
    { n: 12, who: "@pilot.two", len: "0:04" },
    { n: 1, who: "@reel.ruth", len: "0:04" },
    { n: 2, who: "@ledger.lou", len: "0:04" },
    { n: 3, who: "@margin.mo", len: "0:04" },
    { n: 4, who: "@quiet.cut", len: "0:04" },
  ],
  [
    { n: 5, who: "@snip.sam", len: "0:04" },
    { n: 6, who: "@wire.wes", len: "0:04" },
    { n: 7, who: "@proof.pia", len: "0:04" },
    { n: 8, who: "@desk.dee", len: "0:04" },
    { n: 9, who: "@pool.pat", len: "0:04" },
    { n: 10, who: "@stamp.sol", len: "0:04" },
    { n: 11, who: "@trim.tess", len: "0:04" },
    { n: 12, who: "@beat.bo", len: "0:04" },
  ],
];

function ClipSlip({ t, i }: { t: Tile; i: number }) {
  return (
    <li className="cb-slip">
      <LoopClip n={t.n as ClipId} caption={`No. ${String(i + 1).padStart(2, "0")} · ${t.who}`} meta={t.len} />
    </li>
  );
}

export function ClipBand() {
  const band = useRef<HTMLDivElement>(null);

  // Fallback for browsers without CSS scroll-driven animations: write progress 0..1 with rAF.
  useEffect(() => {
    const el = band.current;
    if (!el) return;
    if (CSS.supports("animation-timeline: view()")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="cb" ref={band} role="group" aria-label="Sample clips on the wire">
      <div className="cb-head micro">
        <span>On the wire this week</span>
        <span>Sample footage, not real creators</span>
      </div>
      <div className="cb-clip">
        {ROWS.map((row, r) => (
          <ul key={r} className="cb-row" style={{ ["--dir" as string]: r % 2 === 0 ? -1 : 1 }}>
            {row.map((t, i) => (
              <ClipSlip key={i} t={t} i={r * 8 + i} />
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
