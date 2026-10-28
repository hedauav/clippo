import { createHash } from "node:crypto";
import { db } from "./db";
import { detectViewAnomaly } from "./antifraud/anomaly";
import { checkAvailability } from "./antifraud/availability";
import { markClipDeleted, restoreClip } from "./antifraud/flags";
import { getPlatform, PlatformUnavailableError } from "./platforms";

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Row of GET /api/snapshots/latest, consumed by the CRE workflow (cre/workflows/clippo-settlement/snapshot.ts).
 * campaignId is the NUMERIC on-chain escrow id (uint256 as a decimal string), never the internal cuid.
 */
export interface LatestSnapshot {
  campaignId: string;
  creator: string;
  cumulativeViews: number;
}

/**
 * Latest cumulative views per submission (approved, still-live clips in APPROVED campaigns only).
 * Anti-fraud hold: a clip with an OPEN/CONFIRMED view-anomaly flag is reported only up to the last snapshot BEFORE the flagged day.
 */
export async function latestPerSubmission(asOfDay?: string) {
  const rows = await db.viewSnapshot.findMany({
    where: { ...(asOfDay ? { day: { lte: asOfDay } } : {}), campaign: { status: "APPROVED" }, submission: { clipStatus: "LIVE", verdict: { result: "APPROVE" } } },
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
    include: { campaign: { select: { onchainId: true } }, submission: { select: { creator: { select: { wallet: true } } } } },
  });
  const holds = await db.fraudFlag.findMany({ where: { kind: "VIEW_ANOMALY", status: { in: ["OPEN", "CONFIRMED"] } }, select: { submissionId: true, day: true } });
  const holdDay = new Map<string, string>();
  for (const h of holds) if (!holdDay.has(h.submissionId) || h.day < holdDay.get(h.submissionId)!) holdDay.set(h.submissionId, h.day);
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const hd = holdDay.get(r.submissionId);
    if (hd && r.day >= hd) continue;
    if (!seen.has(r.submissionId)) seen.set(r.submissionId, r);
  }
  return [...seen.values()];
}

/**
 * Per-(on-chain campaign, creator) cumulative views: the payload the CRE workflow reads. Campaigns without an on-chain id
 * are skipped (nothing to settle). Sorted by numeric campaignId, then creator.
 */
export async function latestSnapshots(asOfDay?: string): Promise<LatestSnapshot[]> {
  const agg = new Map<string, LatestSnapshot>();
  for (const r of await latestPerSubmission(asOfDay)) {
    const onchainId = r.campaign.onchainId;
    if (!onchainId || !/^\d+$/.test(onchainId)) continue;
    const creator = r.submission.creator.wallet;
    const key = `${onchainId}:${creator}`;
    const cur = agg.get(key);
    if (cur) cur.cumulativeViews += r.cumulativeViews;
    else agg.set(key, { campaignId: onchainId, creator, cumulativeViews: r.cumulativeViews });
  }
  return [...agg.values()].sort((a, b) => (BigInt(a.campaignId) < BigInt(b.campaignId) ? -1 : BigInt(a.campaignId) > BigInt(b.campaignId) ? 1 : a.creator.localeCompare(b.creator)));
}

/** Fetch fresh view counts and write one snapshot per approved submission for today (monotonic). */
export async function refreshSnapshots() {
  const day = today();
  const subs = await db.submission.findMany({
    where: { campaign: { status: "APPROVED" }, verdict: { result: "APPROVE" } },
    include: { snapshots: { orderBy: { day: "desc" }, take: 9 }, channel: { select: { platform: true } } },
  });
  let updated = 0;
  const failed: string[] = [];
  /** Views not readable automatically (e.g. Instagram): flagged for human review, never silently skipped. */
  const needsHumanReview: string[] = [];
  /** Anti-fraud outputs: submissions flagged for unusual growth, and clips found deleted (balance frozen). */
  const flagged: string[] = [];
  const deleted: string[] = [];
  const restored: string[] = [];

  // A clip that was flagged as deleted but is public again resumes automatically.
  const goneBefore = await db.submission.findMany({
    where: { clipStatus: "DELETED", channel: { platform: "YOUTUBE" }, campaign: { status: "APPROVED" } },
  });
  for (const s of goneBefore) {
    if ((await checkAvailability(s.videoId)) === "available") {
      await restoreClip(s, null);
      restored.push(s.id);
    }
  }

  for (const s of subs) {
    try {
      if (s.channel.platform === "YOUTUBE" && (await checkAvailability(s.videoId)) === "gone") {
        await markClipDeleted(s, day);
        deleted.push(s.id);
        continue;
      }
      const views = await getPlatform(s.channel.platform).client().getViews(s.videoId, { channelId: s.channelId });
      const prev = s.snapshots[0]?.cumulativeViews ?? 0;
      const cumulativeViews = Math.max(prev, views);
      await db.viewSnapshot.upsert({
        where: { submissionId_day: { submissionId: s.id, day } },
        create: { campaignId: s.campaignId, submissionId: s.id, creatorId: s.creatorId, day, cumulativeViews },
        update: { cumulativeViews },
      });
      updated++;
      const history = s.snapshots.filter((x) => x.day !== day).map((x) => ({ day: x.day, views: x.cumulativeViews }));
      const a = detectViewAnomaly(history, { day, views: cumulativeViews });
      if (a.flagged) {
        await db.fraudFlag.upsert({
          where: { submissionId_kind_day: { submissionId: s.id, kind: "VIEW_ANOMALY", day } },
          create: {
            kind: "VIEW_ANOMALY",
            campaignId: s.campaignId,
            submissionId: s.id,
            day,
            details: { delta: Math.round(a.delta), baseline: a.baseline === null ? null : Math.round(a.baseline), threshold: Math.round(a.threshold), ratio: a.ratio, cumulativeViews },
          },
          update: {},
        });
        flagged.push(s.id);
      }
    } catch (e) {
      if (e instanceof PlatformUnavailableError) needsHumanReview.push(s.id);
      else failed.push(s.id);
    }
  }
  return { day, updated, failed, needsHumanReview, flagged, deleted, restored };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC day before `d` (YYYY-MM-DD). */
export const previousDay = (d: string = today()) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export interface FrozenSnapshot {
  /** UTC day this snapshot freezes (all views counted up to the end of that day). */
  day: string;
  /** sha256 of the canonical rows JSON; identical for every reader, also served as the ETag. */
  hash: string;
  rows: LatestSnapshot[];
}

/** Pure: wrap rows in the frozen-day envelope (hash is over the exact JSON of `rows`). */
export function buildFrozenSnapshot(day: string, rows: LatestSnapshot[]): FrozenSnapshot {
  return { day, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), rows };
}

/**
 * One frozen snapshot per UTC day for the CRE workflow: cumulative views as of the END of `day` (default: yesterday, a
 * completed day that refreshSnapshots() no longer writes to, so every CRE node reads identical bytes). Throws on a bad day or
 * a day that is not yet complete.
 */
export async function frozenSnapshot(day: string = previousDay()): Promise<FrozenSnapshot> {
  if (!DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new RangeError("day must be YYYY-MM-DD");
  if (day >= today()) throw new RangeError("day is not complete yet (UTC)");
  return buildFrozenSnapshot(day, await latestSnapshots(day));
}
