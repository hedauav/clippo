"use client";
import { useEffect } from "react";
import { WALLET_INSTALL_LINKS, type DetectedWallet } from "@/lib/chain/wallets";
import "./wallet-picker.css";

/* Wallet icons are data: URIs announced by the extension; next/image cannot optimise them. */
function WalletIcon({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={24} height={24} />;
}

/** Sheet listing the detected browser wallets (EIP-6963 + legacy), or install links when none is found. */
export function WalletPicker({ wallets, onPick, onCancel }: { wallets: DetectedWallet[]; onPick: (w: DetectedWallet) => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="sheet-back" role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="wp-t" data-testid="wallet-picker">
        <span className="micro">Wallet</span>
        <h2 id="wp-t" className="display" style={{ fontSize: "2rem" }}>{wallets.length ? "Choose a wallet" : "No wallet found"}</h2>
        {wallets.length ? (
          <div className="stack wp-list" style={{ gap: 10 }}>
            {wallets.map((w) => (
              <button key={w.id} type="button" className="btn wp-item" onClick={() => onPick(w)}>
                {w.icon ? <WalletIcon src={w.icon} /> : <span className="wp-dot" aria-hidden="true" />}
                <span>{w.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="muted">Clippo signs you in with a browser wallet extension. Install one, create or import an account, then reload this page.</p>
            <ul className="wp-links">
              {WALLET_INSTALL_LINKS.map((l) => (
                <li key={l.name}><a href={l.url} target="_blank" rel="noreferrer noopener">{l.name}</a></li>
              ))}
            </ul>
          </>
        )}
        <div className="row"><button className="btn ghost sm" onClick={onCancel}>{wallets.length ? "Cancel" : "Close"}</button></div>
      </div>
    </div>
  );
}
