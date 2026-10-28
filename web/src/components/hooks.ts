"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { actions, ApiError, asApiError, DEMO, errText, wireProof, NOT_CONFIGURED, session, type ApiUser, type SplitProposal, type WorldProof } from "./api";
import { approveCampaignOnchain, approveSplit, claimPayout, closeCampaignOnchain, fundCampaign, rejectCampaignOnchain } from "@/lib/chain/client";
import { escrowReady, hasWallet, loadChain, onAccountsChanged, type ChainInfo } from "./wallet";
import { detectWallets, getActiveWallet, setActiveWallet, type DetectedWallet } from "@/lib/chain/wallets";

export type AsyncState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ready"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

/** Minimal loader with retry. `fn` should be stable (module-level or useCallback). */
export function useAsync<T>(fn: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [n, setN] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    fn()
      .then((data) => alive.current && setState({ status: "ready", data }))
      .catch((e: unknown) => alive.current && setState({ status: "error", error: e instanceof Error ? e.message : "Request failed" }));
    return () => {
      alive.current = false;
    };
  }, [fn, n]);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setN((x) => x + 1);
  }, []);
  return { ...state, retry } as AsyncState<T> & { retry: () => void };
}

/* ---- session: real wallet connect (injected EIP-1193 wallet, Arc added via wallet_addEthereumChain) + SIWE sign-in ---- */
export type Role = "creator" | "campaigner" | "admin";
const ROLE_OF: Record<ApiUser["role"], Role> = { CREATOR: "creator", CAMPAIGNER: "campaigner", ADMIN: "admin" };

type Store = { user: ApiUser | null; ready: boolean; pickedRole: Role; picked: boolean; rolePrompt: boolean; connecting: boolean; notice: string; connectError: string; picker: { wallets: DetectedWallet[] } | null };
const INIT: Store = { user: null, ready: false, pickedRole: "creator", picked: false, rolePrompt: false, connecting: false, notice: "", connectError: "", picker: null };
let store: Store = INIT;
let started = false;
const listeners = new Set<() => void>();
const emit = (next: Partial<Store>) => {
  store = { ...store, ...next };
  listeners.forEach((l) => l());
};
const fmt = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);
const API_ROLE = { creator: "CREATOR", campaigner: "CAMPAIGNER", admin: undefined } as const;

let pickResolve: { ok: (w: DetectedWallet) => void; cancel: () => void } | null = null;
let unwatch: () => void = () => {};
const watchAccounts = () => {
  unwatch();
  /* The cookie belongs to one wallet. If the wallet switches account, the session no longer matches: end it. */
  unwatch = onAccountsChanged((accts) => {
    const u = store.user;
    if (u && !DEMO && accts[0]?.toLowerCase() !== u.wallet.toLowerCase()) {
      session.logout().catch(() => {});
      emit({ user: null, notice: "Your wallet switched accounts, so you were signed out. Connect again to continue." });
    }
  });
};

/** Pick which injected wallet to use: auto when exactly one is installed, a picker sheet when several, an install sheet when none. */
async function chooseWallet(): Promise<void> {
  if (getActiveWallet()) return;
  const found = await detectWallets();
  if (found.length === 1) return setActiveWallet(found[0]);
  if (found.length === 0) {
    if (DEMO) return; /* demo build: session.login falls back to the sample identities */
    emit({ connecting: false, picker: { wallets: [] } });
    throw new ApiError(0, "NO_WALLET", "No browser wallet found. Install one from the list, then reload this page.");
  }
  pickResolve?.cancel();
  emit({ connecting: false, picker: { wallets: found } });
  const w = await new Promise<DetectedWallet>((ok, cancel) => {
    pickResolve = { ok, cancel: () => cancel(new ApiError(0, "WALLET_CANCELLED", "Wallet selection cancelled.")) };
  });
  setActiveWallet(w);
}

/** Sign in with the wallet. Without a role the server decides: existing accounts keep theirs, a new non-admin wallet gets asked (rolePrompt). */
async function connect(role?: Role) {
  if (store.connecting) throw new ApiError(0, "BUSY", "A wallet request is already in progress.");
  const want = role ?? (store.picked ? store.pickedRole : undefined);
  emit({ connecting: true, notice: "", connectError: "" });
  try {
    await chooseWallet();
    emit({ picker: null, connecting: true });
    const user = await session.login(want ? API_ROLE[want] : undefined, want === "admin");
    emit({ user, pickedRole: ROLE_OF[user.role], picked: true, rolePrompt: false, connecting: false });
    watchAccounts();
    return user;
  } catch (e) {
    /* A new non-admin wallet is asked for a role (sheet in the masthead). Anything else is shown there as a connect error. */
    if (e instanceof ApiError && e.code === "ROLE_REQUIRED") emit({ connecting: false, rolePrompt: true });
    else if (e instanceof ApiError && (e.code === "WALLET_CANCELLED" || (e.code === "NO_WALLET" && store.picker))) emit({ connecting: false });
    else emit({ connecting: false, connectError: errText(e) });
    throw e;
  }
}

export function useSession() {
  const [s, setS] = useState<Store>(INIT);
  useEffect(() => {
    const sync = () => setS(store);
    listeners.add(sync);
    const t = setTimeout(() => {
      sync();
      if (!started) {
        started = true;
        session
          .me()
          .then((user) => {
            emit({ user, ready: true });
            if (user) watchAccounts();
          })
          .catch(() => emit({ ready: true }));
      }
    }, 0);
    return () => {
      clearTimeout(t);
      listeners.delete(sync);
    };
  }, []);

  return {
    ready: s.ready,
    user: s.user,
    address: s.user ? fmt(s.user.wallet) : null,
    role: (s.user ? ROLE_OF[s.user.role] : s.pickedRole) as Role,
    verified: !!s.user?.verified,
    connecting: s.connecting,
    notice: s.notice,
    connectError: s.connectError,
    clearNotice: () => emit({ notice: "", connectError: "" }),
    rolePrompt: s.rolePrompt,
    dismissRolePrompt: () => emit({ rolePrompt: false }),
    /** Connect the wallet and sign in (SIWE). Pass the role the page needs; omit it to keep an existing account's role. */
    connect,
    picker: s.picker,
    hasWallet,
    pickWallet: (w: DetectedWallet) => {
      pickResolve?.ok(w);
      pickResolve = null;
    },
    cancelPicker: () => {
      pickResolve?.cancel();
      pickResolve = null;
      emit({ picker: null });
    },
    pick: (role: Role) => emit({ pickedRole: role, picked: true }),
    disconnect: async () => {
      await session.logout().catch(() => {});
      unwatch();
      setActiveWallet(null);
      emit({ user: null });
    },
    /** Submits an IDKit proof to the backend. Throws ApiError (WORLD_ID_DENIED, ALREADY_USED, ...); nothing changes in that case. */
    verifyWorld: async (proof: WorldProof) => {
      if (!store.user) throw new ApiError(401, "UNAUTHENTICATED", "Connect your wallet first.");
      const base = store.user;
      const u = await session.worldVerify(proof);
      emit({ user: { ...base, ...u, wallet: u.wallet || base.wallet } });
    },
  };
}

/* ---- chain config (shared, cached) ---- */
export function useChainInfo() {
  const [info, setInfo] = useState<ChainInfo | null>(null);
  useEffect(() => {
    let alive = true;
    loadChain().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/* ---- escrow: the real on-chain legs (lib/chain/client.ts). Each sends the wallet transaction first, waits for the receipt,
   then asks the API to verify it on-chain. Without ESCROW configured, money-moving calls refuse with a "not configured" error;
   approve/reject/close go to the API alone so the server (not this client) decides, as documented for dev mode. ---- */
const notConfigured = () => new ApiError(503, "CHAIN_NOT_CONFIGURED", `${NOT_CONFIGURED} The escrow contract address is not set, so nothing was sent.`);
const demoTx = (ms: number) => new Promise<{ txHash: string }>((r) => setTimeout(() => r({ txHash: "0xdemo" + "0".repeat(58) }), ms));

export type FundStep = "approve" | "create" | "verify";
export type SplitResult = { proposal: SplitProposal; attestation: string; txHash: string | null };

/** client.ts throws plain Errors with {code,status}; surface them as ApiError so pages can switch on the code. */
const wrap = <T,>(p: Promise<T>): Promise<T> => p.catch((e) => { throw asApiError(e); });

export const escrow = {
  /** Campaigner: approve USDC (if needed) + createCampaign + server receipt verification. */
  async fund(campaignId: string, onStep?: (s: FundStep) => void): Promise<{ txHash: string }> {
    const info = await loadChain();
    if (!escrowReady(info)) {
      if (DEMO) return demoTx(1200);
      throw notConfigured();
    }
    return wrap(fundCampaign(campaignId, { onStep }));
  },
  /** Creator: claim(id) on the escrow, then server verification. One payout per call. */
  async claim(payoutId: string): Promise<{ txHash: string }> {
    const info = await loadChain();
    if (!escrowReady(info)) {
      if (DEMO) return demoTx(1000);
      throw notConfigured();
    }
    return wrap(claimPayout(payoutId));
  },
  /** Admin: on-chain approveCampaign (with the World ID attestation for high-value pools), then API verification. */
  async approve(c: { id: string; onchainId?: string | null }, attestation?: `0x${string}`) {
    const info = await loadChain();
    if (!escrowReady(info)) return actions.approveCampaign(c.id);
    if (!c.onchainId) throw new ApiError(409, "CHAIN_STATE_MISMATCH", "This campaign has no on-chain id yet, so it cannot be approved on-chain.");
    return wrap(approveCampaignOnchain(c.id, c.onchainId, attestation));
  },
  /** Admin: on-chain rejectCampaign (full refund incl. fee), then API verification. */
  async reject(c: { id: string; onchainId?: string | null }, reason: string) {
    const info = await loadChain();
    if (!escrowReady(info) || !c.onchainId) return actions.rejectCampaign(c.id, reason);
    return wrap(rejectCampaignOnchain(c.id, c.onchainId, reason));
  },
  /** Campaigner/admin: on-chain closeCampaign (unallocated pool refunded), then API verification. */
  async close(c: { id: string; onchainId?: string | null }) {
    const info = await loadChain();
    if (!escrowReady(info)) return actions.closeCampaign(c.id);
    if (!c.onchainId) throw new ApiError(409, "CHAIN_STATE_MISMATCH", "This campaign has no on-chain id yet, so it cannot be closed on-chain.");
    return wrap(closeCampaignOnchain(c.id, c.onchainId));
  },
  /** One approver's split approval: POST /split with THEIR fresh World ID proof, then approveSplit on-chain from their wallet. */
  async approveSplit(campaignId: string, splits: { creatorWallet: string; amount: number }[], proof: WorldProof, agentProposalId?: string): Promise<SplitResult> {
    if (DEMO && !escrowReady(await loadChain())) {
      await demoTx(800);
      return { proposal: { id: "demo", status: "PENDING", splitHash: "0xdemo", approvals: { campaigner: true, admin: false }, awaiting: ["admin"] }, attestation: "0xdemo", txHash: null };
    }
    const r = await wrap(approveSplit(campaignId, splits, wireProof(proof) as never, agentProposalId));
    return { proposal: r.proposal as SplitProposal, attestation: r.attestation, txHash: r.txHash };
  },
};
export const useEscrow = () => escrow;
