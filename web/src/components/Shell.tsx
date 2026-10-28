"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Blades } from "./Icons";
import { useSession } from "./hooks";
import { useDemo } from "./api";
import { pctText, useFees } from "./FeePreview";
import { FAUCET_URL } from "./wallet";
import { WalletPicker } from "./WalletPicker";

const NAV = [
  { href: "/wire", label: "Wire" },
  { href: "/hire", label: "Hire" },
  { href: "/desk", label: "Desk" },
  { href: "/ledger", label: "Ledger" },
  { href: "/bench", label: "Bench" },
  { href: "/account", label: "Account" },
];

/** Visible on the public test deployment only (NEXT_PUBLIC_TEST_DEPLOY=1 at build time). */
export const IS_TEST_DEPLOY = process.env.NEXT_PUBLIC_TEST_DEPLOY === "1";

export function TestnetBanner() {
  if (!IS_TEST_DEPLOY) return null;
  return (
    <div className="testnet-banner" role="note">
      <b>TESTNET</b> — test funds only. Arc testnet USDC has no value; this is a test deployment, so expect resets and please report anything odd.
    </div>
  );
}

export function Dateline() {
  const [d, setD] = useState("");
  useEffect(() => {
    const t = setTimeout(
      () => setD(new Date().toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(/,/g, "")),
      0,
    );
    return () => clearTimeout(t);
  }, []);
  const demo = useDemo();
  return (
    <div className="dateline">
      <div className="wrap">
        <span>{d || " "}</span>
        <span>
          Arc testnet · USDC{demo ? " · demo build, sample data" : ""}
        </span>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const t = setTimeout(() => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") setTheme(attr);
      else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("clippo-theme", next);
    } catch {
      /* ignore */
    }
  };
  return (
    <button className="toggle-theme" onClick={flip} aria-label={`Switch to ${theme === "dark" ? "paper" : "night"} theme`}>
      {theme === "dark" ? "Paper" : "Night"}
    </button>
  );
}

export function Masthead() {
  const path = usePathname();
  const s = useSession();
  const [open, setOpen] = useState(false);
  const connect = () => s.connect().catch(() => {});
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), 0);
    return () => clearTimeout(t);
  }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <header className="masthead">
      <div className="wrap">
        <Link href="/" className="wordmark" aria-label="Clippo, home">
          <b>Clippo</b>
          <Blades />
          <small>Clipping bureau</small>
        </Link>
        <button
          type="button"
          className="menu-btn"
          aria-expanded={open}
          aria-controls="primary-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Menu"}
        </button>
        <nav id="primary-nav" className="nav" aria-label="Primary" data-open={open}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href || path.startsWith(n.href + "/") ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="masthead-tools" data-open={open}>
          <ThemeToggle />
          {s.address ? (
            <button className="wallet" onClick={s.disconnect} title="Disconnect wallet" aria-label={`Signed in as ${s.role}, wallet ${s.address}. Activate to disconnect.`}>
              <span className="micro" style={{ color: "var(--signal)" }}>{s.role}</span> {s.address}
            </button>
          ) : (
            <button className="wallet" onClick={connect} disabled={s.connecting}>
              {s.connecting ? "Check your wallet" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
      {s.picker && <WalletPicker wallets={s.picker.wallets} onPick={s.pickWallet} onCancel={s.cancelPicker} />}
      {s.rolePrompt && (
        <div className="sheet-back" role="presentation">
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="role-t">
            <span className="micro">New wallet</span>
            <h2 id="role-t" className="display" style={{ fontSize: "2rem" }}>Which desk is this wallet for?</h2>
            <p className="muted">A wallet holds one role, and it cannot be changed later. You will sign once more to create the account.</p>
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn" onClick={() => s.connect("creator").catch(() => {})}>I clip: creator</button>
              <button className="btn" onClick={() => s.connect("campaigner").catch(() => {})}>I pay for clips: campaigner</button>
              <button className="btn ghost sm" onClick={s.dismissRolePrompt}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {(s.connectError || s.notice) && (
        <div className="sheet-back" role="presentation">
          <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="cn-t">
            <span className="micro">Wallet</span>
            <h2 id="cn-t" className="display" style={{ fontSize: "2rem" }}>{s.connectError ? "Could not connect" : "Signed out"}</h2>
            <p className="muted">{s.connectError || s.notice}</p>
            <div className="row"><button className="btn" onClick={s.clearNotice}>Close</button></div>
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const fees = useFees();
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="stack">
          <b className="display" style={{ fontSize: "1.6rem" }}>
            <em>Clippo</em>
          </b>
          <p>
            Brands fund a USDC pool. Verified humans post clips. An agent checks each clip against the brief and writes down why. Agents never release
            money on their own.
          </p>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="micro">Desks</span>
          <Link href="/wire">Wire, open campaigns</Link>
          <Link href="/desk/new">Start a campaign</Link>
          <Link href="/join">Join as a creator</Link>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="micro">Fine print</span>
          {IS_TEST_DEPLOY ? <p className="testnet-foot"><b>TESTNET — test funds only.</b> Never send real funds to this app.</p> : null}
          <p>
            {fees && fees !== "failed"
              ? `Platform fee: ${pctText(fees.campaignerBps)} from the campaigner and ${pctText(fees.creatorBps)} from the creator, deducted by the escrow.`
              : fees === "failed"
                ? "Platform fee: the fee schedule could not be read from the service."
                : "Platform fee: reading the schedule from the escrow."}{" "}
            Payouts are USDC on Arc, claimed by the creator.
          </p>
          <a href={FAUCET_URL} target="_blank" rel="noreferrer noopener">Arc testnet USDC faucet</a>
        </div>
      </div>
    </footer>
  );
}
