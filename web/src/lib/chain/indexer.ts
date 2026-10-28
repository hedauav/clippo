import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { ApiError } from "../http";
import { chainConfig } from "./config";
import { publicClient } from "./clients";
import { decodeEscrowLogs, MODE, type EscrowReader, type OnchainCampaign } from "./escrow";
import { liveReader } from "./reader";
import { assertSourceReadyForLaunch } from "../source";
import { notifyAdmins } from "../notify";
import { fromUnits, toUnits } from "./units";

/** Metadata URI convention: the client passes `clippo://campaign/<db id>` to createCampaign so the fund event maps to a DB row. */
export const metadataUriFor = (campaignId: string) => `clippo://campaign/${campaignId}`;
export const campaignIdFromUri = (uri: string) => uri.match(/^clippo:\/\/campaign\/([\w-]+)$/)?.[1] ?? null;

export interface IndexerDeps {
  reader: EscrowReader;
  blockTime(blockNumber: bigint): Promise<Date>;
}

export function liveDeps(): IndexerDeps {
  // evaluated as a default argument before the callers' own checks: answer 503, never a bare 500, when no escrow is configured
  if (!chainConfig().enabled || !chainConfig().escrow) throw new ApiError(503, "CHAIN_NOT_CONFIGURED", "ESCROW_ADDRESS is not configured");
  const pc = publicClient();
  const cache = new Map<bigint, Date>();
  return {
    reader: liveReader(),
    async blockTime(n) {
      const hit = cache.get(n);
      if (hit) return hit;
      const b = await pc.getBlock({ blockNumber: n });
      const d = new Date(Number(b.timestamp) * 1000);
      cache.set(n, d);
      return d;
    },
  };
}

/** Minimal decoded-log shape the indexer needs (a viem decoded log satisfies it). */
export interface IndexedLog {
  eventName?: string;
  args?: unknown;
  transactionHash: string | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}

export type Outcome = { event: string; applied: boolean; reason?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;
type Tx = Prisma.TransactionClient;

interface Prefetch {
  campaign?: OnchainCampaign;
  at?: Date;
  retentionSeconds?: number;
  /** CampaignApproved: why the launch gate (AI-generated source) blocks going live, if it does. */
  launchBlock?: string;
}

const idStr = (v: unknown) => String(v as bigint);
const lower = (a: unknown) => String(a).toLowerCase();

/** Network reads done BEFORE the DB transaction. */
async function prefetch(name: string, a: Args, deps: IndexerDeps, blockNumber: bigint): Promise<Prefetch> {
  const p: Prefetch = {};
  if (name === "CampaignCreated" || name === "CampaignApproved") p.campaign = await deps.reader.getCampaign(a.campaignId);
  if (name === "CampaignApproved") {
    const row = await db.campaign.findFirst({ where: { onchainId: idStr(a.campaignId) } });
    if (row) {
      try {
        await assertSourceReadyForLaunch(row);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        p.launchBlock = e.message;
      }
    }
  }
  if (name === "CreatorCredited") {
    p.at = await deps.blockTime(blockNumber);
    p.retentionSeconds = (await deps.reader.retention()).retentionSeconds;
  }
  if (name === "Claimed") p.at = await deps.blockTime(blockNumber);
  return p;
}

async function byOnchainId(tx: Tx, id: unknown) {
  return tx.campaign.findFirst({ where: { onchainId: idStr(id) } });
}

async function apply(tx: Tx, name: string, a: Args, log: IndexedLog, pre: Prefetch): Promise<Outcome> {
  const txHash = log.transactionHash ?? "";
  switch (name) {
    case "CampaignCreated": {
      const dbId = campaignIdFromUri(String(a.metadataURI));
      if (!dbId) return { event: name, applied: false, reason: "metadataURI is not a clippo campaign reference" };
      const c = await tx.campaign.findUnique({ where: { id: dbId }, include: { campaigner: true } });
      if (!c) return { event: name, applied: false, reason: "unknown campaign" };
      if (c.onchainId) return { event: name, applied: false, reason: "campaign already linked to an on-chain id" };
      if (c.status !== "DRAFT") return { event: name, applied: false, reason: `campaign is ${c.status}, expected DRAFT` };
      if (c.campaigner.wallet !== lower(a.campaigner)) return { event: name, applied: false, reason: "funder is not the campaign owner" };
      if (toUnits(c.poolSize) !== a.grossFunded) return { event: name, applied: false, reason: "funded amount differs from the campaign pool size" };
      const modeOk =
        (c.payoutMode === "PER_VIEW" && Number(a.mode) === MODE.PerView) ||
        (c.payoutMode === "HUMAN_SPLIT" && Number(a.mode) === MODE.HumanSplit) ||
        (c.payoutMode === "POOL_SHARE" && Number(a.mode) === MODE.PoolShare);
      if (!modeOk) return { event: name, applied: false, reason: "payout mode differs from the campaign" };
      if (c.payoutMode === "HUMAN_SPLIT" && (c.approver === "CAMPAIGNER_AND_ADMIN") !== Boolean(a.requireAdminApproval)) {
        return { event: name, applied: false, reason: "approver setting differs from the campaign" };
      }
      await tx.campaign.update({
        where: { id: c.id },
        data: {
          status: "FUNDED",
          onchainId: idStr(a.campaignId),
          fundTxHash: txHash,
          grossFunded: fromUnits(a.grossFunded),
          campaignerFee: fromUnits(a.campaignerFee),
          campaignerFeeBps: pre.campaign?.campaignerFeeBps,
          creatorFeeBps: pre.campaign?.creatorFeeBps,
          highValue: pre.campaign?.highValue ?? false,
        },
      });
      return { event: name, applied: true };
    }
    case "CampaignApproved": {
      const c = await byOnchainId(tx, a.campaignId);
      if (!c) return { event: name, applied: false, reason: "unknown campaign" };
      if (c.status !== "FUNDED") return { event: name, applied: false, reason: `campaign is ${c.status}` };
      if (pre.launchBlock) {
        // An on-chain admin approve must not bypass the AI-source launch gate: keep it off the marketplace, flag for review.
        await tx.campaign.update({ where: { id: c.id }, data: { adminReviewReason: pre.launchBlock, highValue: pre.campaign?.highValue ?? c.highValue } });
        return { event: name, applied: false, reason: `launch gate: ${pre.launchBlock}; flagged for admin review` };
      }
      await tx.campaign.update({
        where: { id: c.id },
        data: { status: "APPROVED", rejectReason: null, adminReviewReason: null, highValue: pre.campaign?.highValue ?? c.highValue },
      });
      return { event: name, applied: true };
    }
    case "HumanAttested": {
      const c = await byOnchainId(tx, a.campaignId);
      if (c && Number(a.kind) === 1) await tx.campaign.update({ where: { id: c.id }, data: { approvalAttestation: String(a.attestation) } });
      return { event: name, applied: !!c };
    }
    case "CampaignRejected": {
      const c = await byOnchainId(tx, a.campaignId);
      if (!c) return { event: name, applied: false, reason: "unknown campaign" };
      if (c.status === "REJECTED") return { event: name, applied: false, reason: "already rejected" };
      await tx.campaign.update({
        where: { id: c.id },
        data: { status: "REJECTED", rejectReason: c.rejectReason ?? "Rejected by admin on-chain; full refund issued." },
      });
      return { event: name, applied: true };
    }
    case "CampaignClosed": {
      const c = await byOnchainId(tx, a.campaignId);
      if (!c) return { event: name, applied: false, reason: "unknown campaign" };
      if (c.status !== "APPROVED") return { event: name, applied: false, reason: `campaign is ${c.status}` };
      await tx.campaign.update({ where: { id: c.id }, data: { status: "CLOSED" } });
      return { event: name, applied: true };
    }
    case "CreatorCredited": {
      const c = await byOnchainId(tx, a.campaignId);
      const u = await tx.user.findUnique({ where: { wallet: lower(a.creator) } });
      if (!c || !u) return { event: name, applied: false, reason: c ? "creator wallet has no account" : "unknown campaign" };
      const amount = fromUnits(a.amount);
      const releaseAt =
        c.payoutMode === "PER_VIEW" && pre.at ? new Date(pre.at.getTime() + (pre.retentionSeconds ?? 0) * 1000) : null;
      const existing = await tx.payout.findFirst({ where: { campaignId: c.id, creatorId: u.id }, orderBy: { createdAt: "asc" } });
      if (existing) {
        await tx.payout.update({
          where: { id: existing.id },
          data: { amount: existing.amount + amount, status: "PENDING", claimedAt: null, ...(releaseAt ? { releaseAt } : {}) },
        });
      } else {
        await tx.payout.create({ data: { campaignId: c.id, creatorId: u.id, amount, releaseAt } });
      }
      return { event: name, applied: true };
    }
    case "SplitFinalized": {
      const c = await byOnchainId(tx, a.campaignId);
      if (!c) return { event: name, applied: false, reason: "unknown campaign" };
      const r = await tx.splitProposal.updateMany({
        where: { campaignId: c.id, splitHash: String(a.splitHash), status: { in: ["PENDING", "AWAITING_CHAIN"] } },
        data: { status: "FINALIZED", finalizedAt: new Date() },
      });
      return { event: name, applied: r.count > 0 };
    }
    case "Claimed": {
      const c = await byOnchainId(tx, a.campaignId);
      const u = await tx.user.findUnique({ where: { wallet: lower(a.creator) } });
      if (!c || !u) return { event: name, applied: false, reason: "unknown campaign or creator" };
      let left = fromUnits(a.gross);
      const payouts = await tx.payout.findMany({ where: { campaignId: c.id, creatorId: u.id }, orderBy: { createdAt: "asc" } });
      for (const p of payouts) {
        if (left <= 1e-9) break;
        const room = p.amount - p.claimedAmount;
        if (room <= 1e-9) continue;
        const take = Math.min(room, left);
        left -= take;
        const claimedAmount = p.claimedAmount + take;
        const done = claimedAmount >= p.amount - 1e-9;
        await tx.payout.update({
          where: { id: p.id },
          data: { claimedAmount, ...(done ? { status: "CLAIMED", claimedAt: pre.at ?? new Date(), claimTxHash: txHash } : {}) },
        });
      }
      return { event: name, applied: true };
    }
    default:
      return { event: name, applied: false, reason: "not tracked" };
  }
}

/** Process one decoded escrow log idempotently (ChainEvent unique on tx hash + log index). */
export async function processLog(log: IndexedLog, deps: IndexerDeps): Promise<Outcome> {
  const name = log.eventName ?? "unknown";
  if (log.transactionHash == null || log.logIndex == null || log.blockNumber == null) {
    return { event: name, applied: false, reason: "pending log" };
  }
  const a = (log.args ?? {}) as Args;
  const key = { txHash: log.transactionHash, logIndex: log.logIndex };
  if (await db.chainEvent.findUnique({ where: { txHash_logIndex: key } })) {
    return { event: name, applied: false, reason: "already processed" };
  }
  const pre = await prefetch(name, a, deps, log.blockNumber);
  const out = await db.$transaction(async (tx) => {
    const res = await apply(tx, name, a, log, pre);
    await tx.chainEvent.create({ data: { ...key, blockNumber: Number(log.blockNumber), name } });
    return res;
  });
  if (out.reason?.startsWith("launch gate")) {
    await notifyAdmins({ type: "LAUNCH_GATE", title: "On-chain approval blocked by the launch gate", body: out.reason, refType: "campaign", refId: idStr(a.campaignId) });
  }
  return out;
}

const order = (a: IndexedLog, b: IndexedLog) =>
  Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0);

export async function processLogs(logs: IndexedLog[], deps: IndexerDeps): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const l of [...logs].sort(order)) out.push(await processLog(l, deps));
  return out;
}

/** Index the escrow events of one transaction (used by fund/claim/approve/... to verify a client-supplied tx hash). */
export async function processReceipt(txHash: string, deps: IndexerDeps = liveDeps()) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new ApiError(400, "BAD_TX_HASH", "txHash must be a 0x-prefixed 32-byte hash");
  const pc = publicClient();
  let receipt;
  try {
    receipt = await pc.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    throw new ApiError(404, "TX_NOT_FOUND", "Transaction not found on the configured chain (not mined yet?)");
  }
  if (receipt.status !== "success") throw new ApiError(422, "TX_REVERTED", "Transaction reverted on-chain");
  const logs = decodeEscrowLogs(receipt.logs);
  // A Claimed event is applied against payouts built from earlier CreatorCredited events. If the periodic sync lags, applying the
  // claim first would drop the part not yet credited in the DB (and the later credit would then show as unclaimed). Catch up first.
  if (logs.some((l) => l.eventName === "Claimed")) await syncChain({}, deps);
  const outcomes = await processLogs(logs, deps);
  return { receipt, logs, outcomes };
}

const CURSOR = "escrow";
const CHUNK = 2000n;

/** Pull new escrow logs since the cursor and apply them. Safe to call repeatedly (cron / admin). */
export async function syncChain(opts: { maxBlocks?: number } = {}, deps: IndexerDeps = liveDeps()) {
  const cfg = chainConfig();
  if (!cfg.enabled || !cfg.escrow) throw new ApiError(503, "CHAIN_NOT_CONFIGURED", "ESCROW_ADDRESS is not configured");
  const pc = publicClient();
  const head = await pc.getBlockNumber({ cacheTime: 0 }); // viem caches the head for ~4s by default: a just-mined tx would be skipped
  const cur = await db.chainCursor.findUnique({ where: { key: CURSOR } });
  let from = cur ? BigInt(cur.lastBlock) + 1n : BigInt(cfg.deployBlock);
  let to = head;
  if (opts.maxBlocks && to - from + 1n > BigInt(opts.maxBlocks)) to = from + BigInt(opts.maxBlocks) - 1n;
  let processed = 0;
  let applied = 0;
  while (from <= to) {
    const end = from + CHUNK - 1n < to ? from + CHUNK - 1n : to;
    const raw = await pc.getLogs({ address: cfg.escrow, fromBlock: from, toBlock: end });
    const outcomes = await processLogs(decodeEscrowLogs(raw), deps);
    processed += outcomes.length;
    applied += outcomes.filter((o) => o.applied).length;
    await db.chainCursor.upsert({ where: { key: CURSOR }, create: { key: CURSOR, lastBlock: Number(end) }, update: { lastBlock: Number(end) } });
    from = end + 1n;
  }
  return { head: Number(head), lastBlock: Number(to), processed, applied };
}
