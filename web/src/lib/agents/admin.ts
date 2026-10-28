import { z } from "zod";
import type { LlmClient } from "../ai/llm";
import type { Story } from "../ai/verifier";
import { askJson, round2, wrapData } from "./ask";
import { precheck } from "./creator";

/* ---------------- disputes ---------------- */

export interface DisputeInput {
  id: string;
  title: string;
  creator: string;
  verdictResult: "APPROVE" | "REJECT" | "NEEDS_HUMAN";
  verdictReason: string;
  confidence: number;
  flags: string[];
  appealNote: string;
  appealOpen: boolean;
  /** hours since the appeal / flag was raised */
  ageHours: number;
  views: number;
  transcript: string | null;
  story: Story;
  campaignPlatforms: string[];
}

export interface Dispute {
  id: string;
  title: string;
  creator: string;
  verdictReason: string;
  appealNote: string;
  summary: string;
  recommend: "overturn" | "uphold" | "review";
  confidence: number;
  rank: number;
  rankWhy: string;
}

const HARD_FLAGS = ["duplicate", "channel_mismatch", "injection_suspected"];

/** Deterministic recommendation (advice only; a human always decides). */
export function assessDispute(d: DisputeInput): Pick<Dispute, "recommend" | "confidence" | "summary"> {
  const facts = [
    d.views ? `${d.views.toLocaleString("en-US")} views so far.` : "",
    d.flags.length ? `Flags: ${d.flags.join(", ")}.` : "",
    d.appealNote ? `Creator says: "${d.appealNote.slice(0, 200)}"` : "",
  ].filter(Boolean);
  const base = `Agent verdict ${d.verdictResult} (${Math.round(d.confidence * 100)}% confidence): ${d.verdictReason}`;

  if (d.flags.some((f) => HARD_FLAGS.includes(f))) {
    return { recommend: "uphold", confidence: 0.9, summary: `${base} A hard rule was triggered (${d.flags.filter((f) => HARD_FLAGS.includes(f)).join(", ")}). ${facts.join(" ")}` };
  }
  if (!d.transcript || d.flags.includes("unreadable")) {
    return { recommend: "review", confidence: 0.4, summary: `${base} The clip could not be read automatically, so only a person can judge it. ${facts.join(" ")}` };
  }
  const blockers = precheck({ story: d.story, text: d.transcript, campaignPlatforms: d.campaignPlatforms }).filter((r) => r.level === "block");
  if (d.verdictResult === "REJECT" && blockers.length === 0) {
    return { recommend: "overturn", confidence: 0.7, summary: `${base} Re-checking the stored transcript finds no blocking issue (disclosure and prohibited claims look fine). ${facts.join(" ")}` };
  }
  if (blockers.length > 0) {
    return { recommend: "uphold", confidence: 0.8, summary: `${base} Re-check confirms: ${blockers.map((b) => b.text).join(" ")} ${facts.join(" ")}` };
  }
  return { recommend: "review", confidence: 0.5, summary: `${base} Borderline; needs a human read. ${facts.join(" ")}` };
}

/** Higher = look first. Money at stake (views), waiting time, and whether the rule outcome is unclear. */
export function disputePriority(d: Pick<DisputeInput, "views" | "ageHours" | "appealOpen" | "flags">, recommend: Dispute["recommend"]): { score: number; why: string } {
  const viewPart = Math.min(40, Math.log10(d.views + 1) * 8);
  const agePart = Math.min(30, d.ageHours / 4);
  const appealPart = d.appealOpen ? 20 : 0;
  const unclearPart = recommend === "review" ? 10 : 0;
  const score = round2(viewPart + agePart + appealPart + unclearPart);
  const why = [
    d.appealOpen ? "open appeal" : "flagged for review",
    d.views ? `${d.views.toLocaleString("en-US")} views at stake` : "no views yet",
    d.ageHours >= 1 ? `waiting ${Math.round(d.ageHours)}h` : "just raised",
    recommend === "review" ? "outcome unclear" : "",
  ].filter(Boolean);
  return { score, why: why.join(", ") };
}

export async function summariseAndRankDisputes(inputs: DisputeInput[], llm: LlmClient): Promise<{ disputes: Dispute[]; usedLlm: boolean }> {
  let usedLlm = false;
  const rows = await Promise.all(
    inputs.map(async (d) => {
      const a = assessDispute(d);
      const p = disputePriority(d, a.recommend);
      const r = await askJson<{ summary: string }>(
        llm,
        {
          system: `Summarise this dispute for an admin in 2-3 sentences, neutral tone, using only the facts given. JSON: {"summary": string}.`,
          user: wrapData("DISPUTE", JSON.stringify({ reason: d.verdictReason, appeal: d.appealNote, facts: a.summary })),
          schema: z.object({ summary: z.string().max(900).optional() }),
          maxTokens: 300,
        },
        { summary: a.summary },
      );
      usedLlm ||= r.usedLlm;
      return { d, a, p, summary: r.value.summary };
    }),
  );
  rows.sort((x, y) => y.p.score - x.p.score);
  return {
    usedLlm,
    disputes: rows.map((r, i) => ({
      id: r.d.id,
      title: r.d.title,
      creator: r.d.creator,
      verdictReason: r.d.verdictReason,
      appealNote: r.d.appealNote,
      summary: r.summary,
      recommend: r.a.recommend,
      confidence: r.a.confidence,
      rank: i + 1,
      rankWhy: r.p.why,
    })),
  };
}

/* ---------------- suspicious view growth ---------------- */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Cumulative snapshots (oldest first) -> views gained per day. */
export const dailyGains = (cumulative: number[]) => cumulative.map((v, i) => (i === 0 ? v : Math.max(0, v - cumulative[i - 1])));

export interface GrowthVerdict {
  flagged: boolean;
  baseline: number;
  peakRatio: number;
  note: string;
}

/**
 * Flags a clip when one day dwarfs the typical (median) day or most of the total arrived in a short burst.
 * Needs >= 3 days of data. Conservative: a flag means "look at it", never an automatic penalty.
 */
export function analyseGrowth(daily: number[], opts: { spikeRatio?: number; minPeak?: number } = {}): GrowthVerdict {
  const spikeRatio = opts.spikeRatio ?? 8;
  const minPeak = opts.minPeak ?? 1000;
  if (daily.length < 3) return { flagged: false, baseline: median(daily), peakRatio: 0, note: "Not enough history yet." };
  const total = daily.reduce((a, b) => a + b, 0);
  const peak = Math.max(...daily);
  const others = daily.filter((_, i) => i !== daily.indexOf(peak));
  const baseline = Math.max(1, median(others));
  const ratio = peak / baseline;
  const top2 = [...daily].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
  const burstShare = total ? top2 / total : 0;
  const spike = peak >= minPeak && ratio >= spikeRatio;
  const burst = daily.length >= 5 && total >= minPeak && burstShare >= 0.85;
  if (spike || burst) {
    return {
      flagged: true,
      baseline: Math.round(baseline),
      peakRatio: round2(ratio),
      note: `Peak day gained ${peak.toLocaleString("en-US")} views, about ${Math.round(ratio)}x the typical ${Math.round(baseline).toLocaleString("en-US")}; ${Math.round(burstShare * 100)}% of ${total.toLocaleString("en-US")} total views arrived in two days. Could be purchased views or a legitimate repost; a human should check.`,
    };
  }
  return { flagged: false, baseline: Math.round(baseline), peakRatio: round2(ratio), note: "Growth looks organic." };
}
