import { decodeAbiParameters, encodeAbiParameters, encodeEventTopics, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { escrowAbi } from "./escrow-abi";
import { decodeEscrowLogs } from "./escrow";
import { claimPreview, fundPreview } from "./fees";
import { attestationHash, normalizeSplit, splitHash } from "./split";
import { bpsOf, fromUnits, toUnits } from "./units";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";

describe("units and fees", () => {
  it("round-trips USDC and rounds fees down like the contract", () => {
    expect(toUnits(12.345678)).toBe(12_345_678n);
    expect(fromUnits(25_000_000n)).toBe(25);
    expect(bpsOf(10_000_000_000n, 25)).toBe(25_000_000n);
    expect(bpsOf(999n, 25)).toBe(2n);
  });

  it("fund preview: fee is withheld from the pool; high value is judged on the net pool", () => {
    const p = fundPreview(10_000, 25, 1000);
    expect(p.campaignerFee).toBe(25);
    expect(p.netPool).toBe(9975);
    expect(p.totalToApprove).toBe(10_000);
    expect(p.highValue).toBe(true);
    expect(fundPreview(1000, 25, 1000).highValue).toBe(false); // net 997.5 <= 1000
    expect(fundPreview(1003, 25, 1000).highValue).toBe(true); // net 1000.49 > 1000
  });

  it("claim preview deducts the creator-side fee", () => {
    expect(claimPreview(50, 25)).toEqual({ gross: 50, creatorFeeBps: 25, fee: 0.125, net: 49.875 });
    expect(claimPreview(10, 0).net).toBe(10);
  });
});

describe("split canonicalisation", () => {
  it("is order-insensitive, merges duplicates and matches the contract hash", () => {
    const one = normalizeSplit([{ creatorWallet: B, amount: 20 }, { creatorWallet: A.toUpperCase().replace("0X", "0x"), amount: 10 }]);
    const two = normalizeSplit([{ creatorWallet: A, amount: 4 }, { creatorWallet: A, amount: 6 }, { creatorWallet: B, amount: 20 }]);
    expect(one.map((e) => e.creatorWallet)).toEqual([A, B]);
    expect(splitHash(one)).toBe(splitHash(two));

    const expected = keccak256(
      encodeAbiParameters([{ type: "address[]" }, { type: "uint256[]" }], [[A, B], [10_000_000n, 20_000_000n]]),
    );
    expect(splitHash(one)).toBe(expected);
  });

  it("a different amount or recipient changes the hash", () => {
    const base = normalizeSplit([{ creatorWallet: A, amount: 10 }]);
    expect(splitHash(base)).not.toBe(splitHash(normalizeSplit([{ creatorWallet: A, amount: 10.000001 }])));
    expect(splitHash(base)).not.toBe(splitHash(normalizeSplit([{ creatorWallet: B, amount: 10 }])));
  });

  it("falls back to a stable hash for non-address demo wallets", () => {
    const s = normalizeSplit([{ creatorWallet: "demo-wallet", amount: 1 }]);
    expect(splitHash(s)).toBe(splitHash(normalizeSplit([{ creatorWallet: "DEMO-wallet", amount: 1 }])));
  });

  it("attestation binds proof, wallet and split", () => {
    const base = { kind: "SPLIT" as const, campaignKey: "7", wallet: A, nullifier: "n1", proofHash: "p1", splitHash: "0xabc" };
    const h1 = attestationHash(base);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(attestationHash({ ...base, proofHash: "p2" })).not.toBe(h1);
    expect(attestationHash({ ...base, wallet: B })).not.toBe(h1);
    expect(attestationHash({ ...base, splitHash: "0xdef" })).not.toBe(h1);
  });
});

describe("escrow log decoding", () => {
  it("decodes a CampaignCreated log and ignores other contracts", () => {
    const escrow = "0x00000000000000000000000000000000000000e5" as const;
    const topics = encodeEventTopics({ abi: escrowAbi, eventName: "CampaignCreated", args: { campaignId: 3n, campaigner: A } });
    const data = encodeAbiParameters(
      [
        { type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint64" }, { type: "bool" }, { type: "string" },
      ],
      [0, 5_000_000n, 10_000_000n, 25_000n, 9_975_000n, 1_900_000_000n, false, "clippo://campaign/abc"],
    );
    const base = { blockHash: null, blockNumber: 1n, logIndex: 0, transactionHash: null, transactionIndex: null, removed: false } as const;
    const logs = [
      { ...base, address: escrow, topics, data },
      { ...base, address: B as `0x${string}`, topics, data },
    ] as Parameters<typeof decodeEscrowLogs>[0];
    const decoded = decodeEscrowLogs(logs, escrow);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].eventName).toBe("CampaignCreated");
    const args = decoded[0].args as unknown as { campaignId: bigint; grossFunded: bigint; metadataURI: string };
    expect(args.campaignId).toBe(3n);
    expect(args.grossFunded).toBe(10_000_000n);
    expect(args.metadataURI).toBe("clippo://campaign/abc");
    expect(decodeAbiParameters([{ type: "uint8" }], `0x${"00".repeat(32)}` as const)[0]).toBe(0);
  });
});
