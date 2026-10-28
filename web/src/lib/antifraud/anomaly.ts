export interface DayViews {
  day: string; // YYYY-MM-DD (UTC)
  views: number; // cumulative
}

export interface AnomalyConfig {
  /** A day's growth below this is never flagged (noise floor). */
  minDelta: number;
  /** Flag when growth/day exceeds baseline x multiplier. */
  multiplier: number;
  /** Snapshots of history needed before the baseline is trusted. */
  minHistory: number;
  /** With no trusted baseline (new clip): flag growth above this multiple of the previous total. */
  newClipFactor: number;
}

export const defaultAnomalyConfig = (): AnomalyConfig => ({
  minDelta: Number(process.env.ANOMALY_MIN_DELTA ?? 5000),
  multiplier: Number(process.env.ANOMALY_MULTIPLIER ?? 5),
  minHistory: 3,
  newClipFactor: 10,
});

export interface AnomalyResult {
  flagged: boolean;
  delta: number; // views gained per day since the last snapshot
  baseline: number | null; // median daily growth in the history
  threshold: number;
  ratio: number | null; // delta / baseline
}

const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Unusual view growth (delta anomaly). `history` = earlier snapshots (any order, cumulative, excluding `latest`).
 * Daily growth since the last snapshot is compared with the median daily growth of the history; a spike is
 * growth > max(minDelta, multiplier x baseline). Clips with too little history use a multiple of the previous total.
 * Pure function: no I/O.
 */
export function detectViewAnomaly(history: DayViews[], latest: DayViews, cfg: AnomalyConfig = defaultAnomalyConfig()): AnomalyResult {
  const h = [...history].sort((a, b) => dayNum(a.day) - dayNum(b.day));
  const last = h[h.length - 1];
  if (!last || dayNum(latest.day) <= dayNum(last.day)) {
    return { flagged: false, delta: 0, baseline: null, threshold: cfg.minDelta, ratio: null };
  }
  const gap = dayNum(latest.day) - dayNum(last.day);
  const delta = Math.max(0, latest.views - last.views) / gap;

  const perDay: number[] = [];
  for (let i = 1; i < h.length; i++) {
    const g = dayNum(h[i].day) - dayNum(h[i - 1].day);
    if (g > 0) perDay.push(Math.max(0, h[i].views - h[i - 1].views) / g);
  }
  if (h.length >= cfg.minHistory && perDay.length >= cfg.minHistory - 1) {
    const baseline = median(perDay);
    const threshold = Math.max(cfg.minDelta, cfg.multiplier * baseline);
    return { flagged: delta > threshold, delta, baseline, threshold, ratio: baseline > 0 ? delta / baseline : null };
  }
  const threshold = Math.max(cfg.minDelta, cfg.newClipFactor * Math.max(last.views, 1));
  return { flagged: delta > threshold, delta, baseline: null, threshold, ratio: null };
}
