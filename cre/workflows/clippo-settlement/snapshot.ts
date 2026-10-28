import { encodeAbiParameters, getAddress, isAddress, type Hex } from "viem";

export type SnapshotRow = {
  campaignId: string; // decimal string (uint256)
  creator: string; // checksummed address
  cumulativeViews: string; // decimal string (uint256)
};

const isUint = (v: unknown): boolean =>
  (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) ||
  (typeof v === "string" && /^\d+$/.test(v));

/**
 * Validate + canonicalise the backend payload so every node produces a byte-identical string
 * (required by consensusIdenticalAggregation). Rows are sorted by (campaignId, creator); duplicates
 * keep the highest cumulativeViews. Invalid rows are dropped.
 */
export function normalizeSnapshot(raw: unknown): string {
  if (!Array.isArray(raw)) throw new Error("snapshot is not an array");
  const best = new Map<string, SnapshotRow>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { campaignId, creator, cumulativeViews } = r as Record<string, unknown>;
    if (!isUint(campaignId) || !isUint(cumulativeViews)) continue;
    if (typeof creator !== "string" || !isAddress(creator, { strict: false })) continue;
    const row: SnapshotRow = {
      campaignId: BigInt(campaignId as string | number).toString(),
      creator: getAddress(creator),
      cumulativeViews: BigInt(cumulativeViews as string | number).toString(),
    };
    const key = `${row.campaignId}:${row.creator}`;
    const prev = best.get(key);
    if (!prev || BigInt(row.cumulativeViews) > BigInt(prev.cumulativeViews)) best.set(key, row);
  }
  const rows = [...best.values()].sort((a, b) => {
    const d = BigInt(a.campaignId) - BigInt(b.campaignId);
    if (d !== 0n) return d < 0n ? -1 : 1;
    return a.creator.localeCompare(b.creator);
  });
  return JSON.stringify(rows);
}

/** ABI-encode as (uint256 campaignId, address creator, uint256 cumulativeViews)[] — matches ClippoReportReceiver.onReport. */
export function encodeReport(rows: SnapshotRow[]): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "campaignId", type: "uint256" },
          { name: "creator", type: "address" },
          { name: "cumulativeViews", type: "uint256" },
        ],
      },
    ],
    [
      rows.map((r) => ({
        campaignId: BigInt(r.campaignId),
        creator: r.creator as `0x${string}`,
        cumulativeViews: BigInt(r.cumulativeViews),
      })),
    ],
  );
}

/** Frozen-day envelope served by GET /api/snapshots/daily (web/src/lib/snapshots.ts FrozenSnapshot). */
export type FrozenFeed = { day: string; hash?: string; rows: unknown };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate the envelope shape; throws on anything the nodes must not sign over. */
export function parseFrozenFeed(raw: unknown): FrozenFeed {
  if (!raw || typeof raw !== "object") throw new Error("feed is not an object");
  const { day, hash, rows } = raw as Record<string, unknown>;
  if (typeof day !== "string" || !DAY_RE.test(day)) throw new Error("feed.day missing or not YYYY-MM-DD");
  if (!Array.isArray(rows)) throw new Error("feed.rows is not an array");
  return { day, hash: typeof hash === "string" ? hash : undefined, rows };
}

/**
 * Staleness guard: the snapshot day must be within `maxStalenessDays` UTC days before `now` (and never in the future).
 * Days compare as UTC calendar days, so a snapshot for "yesterday" has age 1.
 */
export function assertFresh(day: string, now: Date, maxStalenessDays: number): void {
  const ageDays = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (ageDays < 0) throw new Error(`snapshot day ${day} is in the future`);
  if (ageDays > maxStalenessDays) throw new Error(`snapshot day ${day} is stale (${ageDays}d old, max ${maxStalenessDays}d)`);
}

/** Split rows into batches so each report stays under the receiver's gas budget. */
export function chunkRows<T>(rows: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
