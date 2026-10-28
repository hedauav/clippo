import { bpsOf, fromUnits, toUnits } from "./units";
import { chainEnabled } from "./config";
import { liveReader } from "./reader";

export interface PlatformFees {
  campaignerBps: number;
  creatorBps: number;
  /** "chain" = read from the escrow contract; "config" = env fallback / chain not configured */
  source: "chain" | "config";
  /** PerView credits become claimable this long after being credited */
  retentionDays: number;
  /** Pools above this (USDC) are "high value": approvals need a fresh human attestation */
  highValueThresholdUsdc: number;
}

/** PRD 4.5: 0.1 to 0.5 per side, read as percent = 10..50 bps. Out-of-range or unparsable env values fall back to 25 bps (0.25%). */
export const FEE_BPS_MIN = 10;
export const FEE_BPS_MAX = 50;
const envBps = (name: string) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= FEE_BPS_MIN && n <= FEE_BPS_MAX ? Math.round(n) : 25;
};

let cache: { at: number; value: PlatformFees } | null = null;
const TTL = 60_000;

export function configFees(): PlatformFees {
  return {
    campaignerBps: envBps("PLATFORM_CAMPAIGNER_FEE_BPS"),
    creatorBps: envBps("PLATFORM_CREATOR_FEE_BPS"),
    source: "config",
    retentionDays: Number(process.env.RETENTION_DAYS ?? 7),
    highValueThresholdUsdc: Number(process.env.HIGH_VALUE_THRESHOLD_USDC ?? 1000),
  };
}

/** Per-side platform fees: read from the escrow when configured (cached 60s), else env. */
export async function getPlatformFees(): Promise<PlatformFees> {
  if (!chainEnabled()) return configFees();
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  try {
    const r = liveReader();
    const [f, ret] = await Promise.all([r.fees(), r.retention()]);
    const value: PlatformFees = {
      campaignerBps: f.campaignerBps,
      creatorBps: f.creatorBps,
      source: "chain",
      retentionDays: ret.retentionSeconds / 86400,
      highValueThresholdUsdc: fromUnits(ret.highValueThreshold),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? configFees();
  }
}

export const resetFeeCache = () => {
  cache = null;
};

/** Fund preview: the campaigner pays `gross`; the campaigner-side fee is withheld from it. */
export function fundPreview(poolSizeUsdc: number, campaignerBps: number, highValueThresholdUsdc: number) {
  const gross = toUnits(poolSizeUsdc);
  const fee = bpsOf(gross, campaignerBps);
  const net = gross - fee;
  return {
    poolAmount: poolSizeUsdc,
    campaignerFeeBps: campaignerBps,
    campaignerFee: fromUnits(fee),
    netPool: fromUnits(net),
    totalToApprove: poolSizeUsdc,
    highValue: net > toUnits(highValueThresholdUsdc),
  };
}

/** Claim preview: creator-side fee is deducted from the gross payout. */
export function claimPreview(grossUsdc: number, creatorBps: number) {
  const gross = toUnits(grossUsdc);
  const fee = bpsOf(gross, creatorBps);
  return { gross: grossUsdc, creatorFeeBps: creatorBps, fee: fromUnits(fee), net: fromUnits(gross - fee) };
}
