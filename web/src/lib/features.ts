import { ApiError } from "./http";

/** Optional modules, all OFF by default. Enabled only by env value "true" or "1". */
export const FEATURES = {
  tokenization: "FEATURE_TOKENIZATION",
  referral: "FEATURE_REFERRAL",
  statusLadder: "FEATURE_STATUS_LADDER",
} as const;

export type FeatureName = keyof typeof FEATURES;

export function isEnabled(feature: FeatureName): boolean {
  const v = (process.env[FEATURES[feature]] ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Throws a 404 when the feature is off so disabled endpoints look absent. */
export function requireFeature(feature: FeatureName): void {
  if (!isEnabled(feature)) {
    throw new ApiError(404, "FEATURE_DISABLED", `Module "${feature}" is not enabled`);
  }
}
