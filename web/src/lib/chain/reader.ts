import { getOverride } from "../config";
import { chainConfig } from "./config";
import { publicClient } from "./clients";
import { escrowAbi } from "./escrow-abi";
import type { EscrowReader, OnchainCampaign } from "./escrow";

/** Live reader backed by the RPC. */
export function liveReader(): EscrowReader {
  const o = getOverride<EscrowReader>("escrowReader");
  if (o) return o;
  const address = chainConfig().escrow;
  if (!address) throw new Error("ESCROW_ADDRESS is not configured");
  const pc = publicClient();
  const read = <F extends string>(functionName: F, args: readonly unknown[] = []) =>
    pc.readContract({ address, abi: escrowAbi, functionName: functionName as never, args: args as never }) as Promise<unknown>;
  return {
    async getCampaign(id) {
      return (await read("getCampaign", [id])) as OnchainCampaign;
    },
    async approvalAttestation(id) {
      return (await read("approvalAttestation", [id])) as `0x${string}`;
    },
    async fees() {
      const [a, b] = await Promise.all([read("campaignerFeeBps"), read("creatorFeeBps")]);
      return { campaignerBps: Number(a), creatorBps: Number(b) };
    },
    async retention() {
      const [r, t] = await Promise.all([read("retentionPeriod"), read("highValueThreshold")]);
      return { retentionSeconds: Number(r), highValueThreshold: t as bigint };
    },
  };
}
