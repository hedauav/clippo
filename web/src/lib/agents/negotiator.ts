import { z } from "zod";
import type { LlmClient } from "../ai/llm";
import { askJson, round2, wrapData } from "./ask";

/**
 * Rate negotiator (PRD 4.8). The RATE is computed here, deterministically, inside the limits both sides set; the model
 * may only phrase the note. A deal needs both sides to accept, and accepting a rate never moves money.
 *
 *  - Campaigner publishes a band {minRate, maxRate} (USDC per 1k views) and optionally `autoAcceptUpTo`, a standing
 *    instruction that pre-accepts creator offers at or below it on the campaigner's behalf.
 *  - Creator sets a private floor `creatorMin`.
 */
export interface Band {
  minRate: number;
  maxRate: number;
  autoAcceptUpTo?: number | null;
}

/** Overlap of the campaigner's band and the creator's floor, or null when there is none. */
export function negotiableRange(band: Band, creatorMin?: number | null): { floor: number; ceiling: number } | null {
  const floor = Math.max(band.minRate, creatorMin ?? 0);
  return floor <= band.maxRate ? { floor, ceiling: band.maxRate } : null;
}

export type OfferCheck = { ok: true } | { ok: false; code: "OUTSIDE_LIMITS" | "NO_OVERLAP"; message: string };

export function checkOffer(rate: number, band: Band, creatorMin?: number | null): OfferCheck {
  const range = negotiableRange(band, creatorMin);
  if (!range) return { ok: false, code: "NO_OVERLAP", message: "The creator's minimum is above the campaigner's maximum; there is no rate both sides can accept." };
  if (rate < range.floor || rate > range.ceiling) {
    return { ok: false, code: "OUTSIDE_LIMITS", message: `Offers must sit within the limits both sides set (campaign band $${band.minRate.toFixed(2)} to $${band.maxRate.toFixed(2)} per 1K views, and the creator's own minimum).` };
  }
  return { ok: true };
}

export type Counter =
  | { action: "ACCEPT_FOR_CAMPAIGNER"; rate: number; note: string }
  | { action: "COUNTER"; rate: number; note: string }
  | { action: "NO_OVERLAP"; note: string };

/** Response of the negotiator to a creator offer. Never returns a rate outside the agreed limits. */
export function counterOffer(offer: number, band: Band, creatorMin?: number | null, listedRate?: number | null): Counter {
  const range = negotiableRange(band, creatorMin);
  if (!range) return { action: "NO_OVERLAP", note: "No overlap between the limits; a human conversation is needed." };
  const rate = round2(Math.min(range.ceiling, Math.max(range.floor, offer)));
  if (band.autoAcceptUpTo != null && rate <= band.autoAcceptUpTo) {
    return {
      action: "ACCEPT_FOR_CAMPAIGNER",
      rate,
      note: `Inside the campaigner's pre-authorised limit of $${band.autoAcceptUpTo.toFixed(2)}. Recorded as accepted on the campaigner's behalf; the creator still confirms.`,
    };
  }
  const target = band.autoAcceptUpTo ?? listedRate ?? (range.floor + range.ceiling) / 2;
  const counter = round2(Math.min(range.ceiling, Math.max(range.floor, (rate + target) / 2)));
  return {
    action: "COUNTER",
    rate: counter,
    note: `Counter on behalf of the campaigner: between the offer of $${rate.toFixed(2)} and the target of $${target.toFixed(2)}, inside the $${range.floor.toFixed(2)} to $${range.ceiling.toFixed(2)} band.`,
  };
}

/** Let the model rephrase the note only; the numbers in it are checked to be unchanged. */
export async function phraseNote(llm: LlmClient, counter: Counter): Promise<string> {
  const r = await askJson<{ note: string }>(
    llm,
    {
      system: `Rewrite this negotiation note in one friendly, factual sentence. Keep every dollar amount exactly as written. JSON: {"note": string}.`,
      user: wrapData("NOTE", counter.note),
      schema: z.object({ note: z.string().max(400).optional() }),
      maxTokens: 150,
    },
    { note: counter.note },
  );
  const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(",");
  return nums(r.value.note) === nums(counter.note) ? r.value.note : counter.note;
}
