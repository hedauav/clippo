import { decodeEventLog, parseEventLogs, type Log, type TransactionReceipt } from "viem";
import { chainConfig } from "./config";
import { escrowAbi } from "./escrow-abi";

/** Mirrors the contract enums. */
export const STATE = { None: 0, Funded: 1, Approved: 2, Rejected: 3, Closed: 4 } as const;
export const MODE = { PerView: 0, HumanSplit: 1, PoolShare: 2 } as const;

export interface OnchainCampaign {
  campaigner: `0x${string}`;
  mode: number;
  state: number;
  requireAdminApproval: boolean;
  campaignerFeeBps: number;
  creatorFeeBps: number;
  deadline: bigint;
  ratePer1kViews: bigint;
  grossFunded: bigint;
  campaignerFee: bigint;
  pool: bigint;
  allocated: bigint;
  metadataURI: string;
  highValue: boolean;
}

/** Narrow reader used by the indexer/verifiers (swappable in tests). */
export interface EscrowReader {
  getCampaign(id: bigint): Promise<OnchainCampaign>;
  approvalAttestation(id: bigint): Promise<`0x${string}`>;
  fees(): Promise<{ campaignerBps: number; creatorBps: number }>;
  retention(): Promise<{ retentionSeconds: number; highValueThreshold: bigint }>;
}

export type EscrowLog = ReturnType<typeof decodeEscrowLogs>[number];

/** Decode escrow events out of raw logs, keeping only logs emitted by the configured escrow. */
export function decodeEscrowLogs(logs: Log[], escrow = chainConfig().escrow) {
  const mine = escrow ? logs.filter((l) => l.address.toLowerCase() === escrow.toLowerCase()) : logs;
  return parseEventLogs({ abi: escrowAbi, logs: mine, strict: false }).filter((l) => !!l.eventName);
}

export const decodeReceipt = (r: TransactionReceipt) => decodeEscrowLogs(r.logs);

export { decodeEventLog };
