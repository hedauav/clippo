export const money = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const whole = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export const compact = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};

export const MODE_LABEL = {
  per_view: "Per verified view",
  human_split: "Human-approved split",
  pool_share: "Pool share",
} as const;

export const PLATFORM_LABEL = { youtube: "YouTube", x: "X", instagram: "Instagram" } as const;
