/* Demo store for the creator workspace. Used only while the service is unreachable.
   Persistence is per-browser localStorage (always in try/catch). Share tokens carry a snapshot of the record, so a shared
   link opens in another browser without a server. Nothing here is sent anywhere. */
import { demoCreators, type Brief, type DirCreator, type Line, type Shortlist, type Workspace } from "@/ui-mocks/workspace";

const K = { sel: "clippo-ws-sel", spaces: "clippo-ws-spaces" };
const byId = (id: string) => demoCreators.find((c) => c.id === id);

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked: the page still works for this visit */
  }
}
const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = <T,>(s: string): T | null => {
  try {
    const p = s.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4))))) as T;
  } catch {
    return null;
  }
};
const rid = () => `demo-${Math.random().toString(36).slice(2, 8)}`;
export const isDemoId = (id: string) => id.startsWith("demo-") || id.startsWith("demo.") || id.startsWith("cr-");

/* ---- selection (the clipped tray). Ids are creator ids from the directory in use. ---- */
const selListeners = new Set<() => void>();
export const selection = {
  set: (ids: string[]) => {
    write(K.sel, ids);
    selListeners.forEach((l) => l());
  },
  subscribe: (cb: () => void) => {
    selListeners.add(cb);
    return () => selListeners.delete(cb);
  },
};

export const mockDirectory = (): DirCreator[] => demoCreators;

export function mockCreateList(title: string, ids: string[]): Shortlist {
  return { token: `demo.l${enc({ title, ids })}`, title, creators: ids.map(byId).filter((c): c is DirCreator => !!c) };
}
export function mockGetList(token: string): Shortlist | null {
  const s = token.startsWith("demo.l") ? dec<{ title: string; ids: string[] }>(token.slice(6)) : null;
  if (!s || !Array.isArray(s.ids)) return null;
  return { token, title: s.title, creators: s.ids.map(byId).filter((c): c is DirCreator => !!c) };
}

const spaces = () => read<Workspace[]>(K.spaces, []);
const total = (lines: Line[]) => Math.round(lines.filter((l) => l.status === "APPROVED").reduce((a, l) => a + l.amount, 0) * 100) / 100;
const finish = (w: Workspace): Workspace => {
  const x = { ...w, token: null, approvedTotal: total(w.lines) };
  return { ...x, token: `demo.w${enc(x)}` };
};
const store = (w: Workspace) => {
  const next = finish(w);
  write(K.spaces, spaces().some((s) => s.id === w.id) ? spaces().map((s) => (s.id === w.id ? next : s)) : [next, ...spaces()]);
  return next;
};

export function mockCreateWorkspace(brief: Brief, picks: { creatorId: string; rateLabel: string; quantity: number }[]): Workspace {
  const lines: Line[] = picks.map((p) => {
    const c = byId(p.creatorId)!;
    const r = c.rates.find((x) => x.label === p.rateLabel) ?? c.rates[0];
    return { creatorId: c.id, name: c.name, tier: c.tier, rateLabel: r.label, quantity: p.quantity, amount: r.price * p.quantity, status: "PROPOSED", clips: [], approvedClips: 0, views: 0, paid: 0 };
  });
  return store({
    id: rid(), token: null, serial: String(Math.floor(1000 + Math.random() * 8999)), title: brief.title,
    brief: { summary: brief.summary, mustSay: brief.mustSay, mustNot: brief.mustNot, disclosure: brief.disclosure, due: brief.due, objective: brief.objective, brand: brief.brand },
    cap: brief.cap, status: "OPEN", campaignId: null, approvedTotal: 0, lines,
  });
}
export const mockGetWorkspace = (id: string): Workspace | null => spaces().find((w) => w.id === id) ?? null;
export function mockGetShared(token: string): Workspace | null {
  const w = token.startsWith("demo.w") ? dec<Workspace>(token.slice(6)) : null;
  return w && Array.isArray(w.lines) ? { ...w, token: null } : null;
}
export const mockSetStatus = (w0: Workspace, creatorId: string, status: Line["status"]): Workspace => {
  const w = mockGetWorkspace(w0.id) ?? w0;
  return store({ ...w, lines: w.lines.map((l) => (l.creatorId === creatorId ? { ...l, status } : l)) });
};

/** Demo tracking seed applied when "fund all" lands: the first approved creator has already posted one clip. */
export function mockFund(w0: Workspace, tx: string): Workspace {
  const w = mockGetWorkspace(w0.id) ?? w0;
  let first = true;
  const lines = w.lines.map((l) => {
    if (l.status !== "APPROVED" || !first) return l;
    first = false;
    return { ...l, clips: [{ link: `https://youtu.be/demo-${l.creatorId.slice(-4)}`, verdict: "APPROVE", views: 18_400 }], approvedClips: 1, views: 18_400 };
  });
  return store({ ...w, lines, status: "FUNDING", fundTx: tx, campaignId: `demo-${w.id}` });
}
