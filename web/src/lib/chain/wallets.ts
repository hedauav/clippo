"use client";
/**
 * Browser wallet discovery: EIP-6963 (multi-wallet, each wallet announces itself) plus the legacy `window.ethereum`
 * (including `window.ethereum.providers` when several extensions fight over the global). Pure browser code.
 */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, fn: (...a: never[]) => void): void;
  removeListener?(event: string, fn: (...a: never[]) => void): void;
}
export interface DetectedWallet {
  id: string;
  name: string;
  icon?: string;
  rdns?: string;
  provider: Eip1193;
}
interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}
type Flagged = Eip1193 & Record<string, unknown> & { providers?: Eip1193[] };

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export const WALLET_INSTALL_LINKS = [
  { name: "MetaMask", url: "https://metamask.io/download/" },
  { name: "Rabby", url: "https://rabby.io/" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads" },
  { name: "Brave Wallet", url: "https://brave.com/wallet/" },
  { name: "OKX Wallet", url: "https://www.okx.com/web3" },
  { name: "Phantom", url: "https://phantom.com/download" },
] as const;

const announced = new Map<string, DetectedWallet>();
let listening = false;

function startDiscovery() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", ((e: CustomEvent<Eip6963Detail>) => {
    const d = e.detail;
    if (!d?.provider || !d.info) return;
    announced.set(d.info.uuid, { id: d.info.rdns || d.info.uuid, name: d.info.name, icon: d.info.icon, rdns: d.info.rdns, provider: d.provider });
  }) as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

const legacyName = (p: Flagged): string => {
  if (p.isRabby) return "Rabby";
  if (p.isBraveWallet) return "Brave Wallet";
  if (p.isOkxWallet || p.isOKExWallet) return "OKX Wallet";
  if (p.isCoinbaseWallet || p.isCoinbaseBrowser) return "Coinbase Wallet";
  if (p.isPhantom) return "Phantom";
  if (p.isMetaMask) return "MetaMask";
  return "Browser wallet";
};

function legacyWallets(): DetectedWallet[] {
  const eth = typeof window !== "undefined" ? (window.ethereum as Flagged | undefined) : undefined;
  if (!eth) return [];
  const list = Array.isArray(eth.providers) && eth.providers.length ? (eth.providers as Flagged[]) : [eth];
  return list.map((p, i) => ({ id: `legacy:${legacyName(p)}:${i}`, name: legacyName(p), provider: p }));
}

/** Synchronous snapshot of every wallet seen so far. EIP-6963 entries win; legacy providers already announced are skipped. */
export function listWallets(): DetectedWallet[] {
  startDiscovery();
  const out = [...announced.values()];
  for (const l of legacyWallets()) if (!out.some((w) => w.provider === l.provider)) out.push(l);
  return out;
}

/** Ask wallets to announce, give them a moment (extensions inject late), then list. */
export async function detectWallets(waitMs = 250): Promise<DetectedWallet[]> {
  startDiscovery();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
  if (!listWallets().length) await new Promise((r) => setTimeout(r, waitMs));
  return listWallets();
}

let active: DetectedWallet | null = null;
export const getActiveWallet = () => active;
export const setActiveWallet = (w: DetectedWallet | null) => {
  active = w;
};
/** The provider every wallet call goes through: the one the user picked, else window.ethereum. */
export function activeProvider(): Eip1193 | null {
  return active?.provider ?? (typeof window !== "undefined" ? (window.ethereum ?? null) : null);
}
