import { z } from "zod";

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const rateCardSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(80),
      platform: z.enum(["YOUTUBE", "X", "INSTAGRAM"]).optional(),
      price: z.number().positive().max(1_000_000),
    }),
  )
  .min(1)
  .max(20)
  .refine((a) => new Set(a.map((x) => x.label.toLowerCase())).size === a.length, "rate labels must be unique");
export type RateCard = z.infer<typeof rateCardSchema>;

export interface BudgetRow {
  status: string;
  amount: number;
}

/** Live budget rollup for a hire: approved total is what "fund all" will escrow. */
export function budgetTotals(rows: BudgetRow[]) {
  const sum = (st: string) => round2(rows.filter((r) => r.status === st).reduce((n, r) => n + r.amount, 0));
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  return {
    approvedTotal: sum("APPROVED"),
    proposedTotal: sum("PROPOSED"),
    rejectedTotal: sum("REJECTED"),
    approvedCount: count("APPROVED"),
    proposedCount: count("PROPOSED"),
    rejectedCount: count("REJECTED"),
  };
}

/** Price a rate-card line: price x quantity. Throws if the label is not on the card. */
export function priceFromCard(card: RateCard, label: string, quantity: number): number {
  const line = card.find((l) => l.label.toLowerCase() === label.toLowerCase());
  if (!line) throw new Error(`Rate "${label}" is not on the creator's rate card`);
  return round2(line.price * quantity);
}

/** Fund-all mapping -> HUMAN_SPLIT campaign params + the preset split list (see API.md). */
export function fundAllPlan(rows: { wallet: string; amount: number; status: string }[]) {
  const approved = rows.filter((r) => r.status === "APPROVED");
  return {
    poolSize: round2(approved.reduce((n, r) => n + r.amount, 0)),
    splits: approved.map((r) => ({ creatorWallet: r.wallet, amount: round2(r.amount) })),
  };
}
