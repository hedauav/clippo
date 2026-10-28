"use client";
import { LoopClip, type ClipId } from "./LoopClip";
import type { ReactNode } from "react";
import Link from "next/link";
import type { Campaign } from "@/ui-mocks/data";
import { MODE_LABEL, PLATFORM_LABEL, compact, money } from "./format";
import { PlatformGlyph } from "./Icons";
import { useDemo } from "./api";
import { ServiceState, isServiceMessage } from "./ServiceState";

export function TickBar({ pct, label, big, sig }: { pct: number; label: string; big?: boolean; sig?: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={`ticks${big ? " big" : ""}${sig ? " sig" : ""}`} role="img" aria-label={label}>
      <i style={{ "--p": `${p}%` } as React.CSSProperties} />
    </div>
  );
}

export function Slip({ c }: { c: Campaign }) {
  const pct = c.pool ? (c.paid / c.pool) * 100 : 0;
  return (
    <Link href={`/slips/${c.id}`} className="slip">
      <span className="serial">No. {c.serial}</span>
      <div className="meta">
        <span className="micro">{c.brand}</span>
        <span className="micro">{MODE_LABEL[c.mode]}</span>
        {c.access === "ranked" && <span className="tag solid">Ranked only</span>}
      </div>
      <h3>{c.title}</h3>
      <div className="rate">
        {c.mode === "per_view" ? (
          <>
            <b>${money(c.rate)}</b>
            <span>per 1K views</span>
          </>
        ) : (
          <>
            <b>${money(c.pool, 0)}</b>
            <span>{c.mode === "pool_share" ? `shared by ${c.shareBy === "views" ? "views" : "approved clips"}` : "split by approval"}</span>
          </>
        )}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <TickBar pct={pct} label={`${Math.round(pct)} percent of the pool allocated`} />
        <div className="foot-row">
          <span className="fig" style={{ fontSize: "0.8rem" }}>
            ${money(c.pool - c.paid, 0)} left of ${money(c.pool, 0)}
          </span>
          <span className="micro">{c.closesIn ? `closes in ${c.closesIn}` : "open until closed"}</span>
        </div>
      </div>
      <div className="foot-row">
        <span className="row" style={{ gap: 6 }}>
          {c.platforms.map((p) => (
            <PlatformGlyph key={p} p={p} />
          ))}
        </span>
        <span className="micro">
          {c.views ? `${compact(c.views)} views` : "no views yet"}{c.creators ? ` · ${c.creators} creators` : ""}
        </span>
      </div>
      <span className="sr">Platforms: {c.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}</span>
    </Link>
  );
}

export function Loading({ label = "Setting type", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="state-load" role="status" aria-live="polite">
      <div className="ln">
        {label}
        <span className="caret" aria-hidden="true" />
      </div>
      {Array.from({ length: rows - 1 }, (_, i) => (
        <div className="ln" key={i} aria-hidden="true" />
      ))}
    </div>
  );
}

export function Empty({ title, children, action, clip }: { title: string; children?: ReactNode; action?: ReactNode; clip?: ClipId }) {
  return (
    <div className="empty">
      {clip && <LoopClip n={clip} caption="Waiting on a clip" className="lc-side" />}
      <b>{title}</b>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Correction({ what, fix, cause, onRetry }: { what: string; fix?: string; cause?: string; onRetry?: () => void }) {
  /* "The service is down" and "not configured" get their own designed state, whichever prop carried the message. */
  const svc = [what, cause, fix].find((x) => x && isServiceMessage(x));
  if (svc) return <ServiceState what={svc} onRetry={onRetry} />;
  return (
    <div className="correction" role="alert">
      <span className="micro">Correction</span>
      <b>{what}</b>
      {fix && <span>{fix}</span>}
      {onRetry && (
        <button className="linkbtn" onClick={onRetry} style={{ justifySelf: "start" }}>
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHead({ kicker, title, children }: { kicker: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="micro">{kicker}</div>
      <h1 className="display h2" style={{ fontSize: "clamp(2.4rem, 5.5vw, 4.4rem)" }}>
        {title}
      </h1>
      {children && <div className="lead">{children}</div>}
    </header>
  );
}

export function DemoNote({ always, label }: { always?: boolean; label?: string }) {
  const demo = useDemo();
  if (!demo && !always) return null;
  return (
    <p className="micro" style={{ color: "var(--hold)" }}>
      {label ?? "Demo build (NEXT_PUBLIC_DEMO=1): figures on this page are sample data."}
    </p>
  );
}
