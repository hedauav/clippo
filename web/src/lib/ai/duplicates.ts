import { createHash } from "node:crypto";

export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const hashTranscript = (s: string) => createHash("sha256").update(normalizeText(s)).digest("hex");

function shingles(s: string, n = 3): Set<string> {
  const w = normalizeText(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (w.length < n) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i <= w.length - n; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** Jaccard similarity over word 3-shingles, in [0,1]. */
export function similarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface ExistingClip {
  id: string;
  transcript: string | null;
  transcriptHash: string | null;
}

export type DuplicateCheck =
  | { kind: "none" }
  | { kind: "exact"; matchId: string }
  | { kind: "near"; matchId: string; score: number };

export const NEAR_DUPLICATE_THRESHOLD = 0.8;

export function detectDuplicate(transcript: string, existing: ExistingClip[]): DuplicateCheck {
  const h = hashTranscript(transcript);
  const exact = existing.find((e) => e.transcriptHash === h);
  if (exact) return { kind: "exact", matchId: exact.id };
  let best: { id: string; score: number } | null = null;
  for (const e of existing) {
    if (!e.transcript) continue;
    const score = similarity(transcript, e.transcript);
    if (!best || score > best.score) best = { id: e.id, score };
  }
  if (best && best.score >= NEAR_DUPLICATE_THRESHOLD) return { kind: "near", matchId: best.id, score: best.score };
  return { kind: "none" };
}
