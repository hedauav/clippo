"use client";
import { useEffect, useState } from "react";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Counts the sample pool down by one payout. Jumps straight to the end for reduced motion. */
export function PoolTicker({ from, to, delay = 1400, ms = 900 }: { from: number; to: number; delay?: number; ms?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now() + (reduced ? 0 : delay);
    const dur = reduced ? 1 : ms;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / dur));
      setV(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, delay, ms]);
  return <span>{fmt(v)}</span>;
}
