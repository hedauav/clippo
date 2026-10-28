import { describe, expect, it } from "vitest";
import { detectViewAnomaly, type AnomalyConfig, type DayViews } from "./anomaly";

const cfg: AnomalyConfig = { minDelta: 5000, multiplier: 5, minHistory: 3, newClipFactor: 10 };
const h = (...v: number[]): DayViews[] => v.map((views, i) => ({ day: `2026-01-${String(i + 1).padStart(2, "0")}`, views }));

describe("detectViewAnomaly", () => {
  it("does not flag steady growth", () => {
    const r = detectViewAnomaly(h(1000, 1300, 1600, 1900), { day: "2026-01-05", views: 2200 }, cfg);
    expect(r.flagged).toBe(false);
    expect(r.baseline).toBe(300);
  });

  it("flags a spike far above the median daily growth", () => {
    const r = detectViewAnomaly(h(1000, 2000, 3000, 4000), { day: "2026-01-05", views: 40000 }, cfg);
    expect(r.flagged).toBe(true);
    expect(r.delta).toBe(36000);
    expect(r.ratio).toBeCloseTo(36);
  });

  it("ignores spikes below the noise floor even when the ratio is huge", () => {
    const r = detectViewAnomaly(h(10, 11, 12, 13), { day: "2026-01-05", views: 2000 }, cfg);
    expect(r.flagged).toBe(false);
  });

  it("scales growth by the gap in days (missed refresh is not a spike)", () => {
    const r = detectViewAnomaly(h(0, 3000, 6000, 9000), { day: "2026-01-08", views: 21000 }, cfg); // 12000 over 4 days = 3000/day
    expect(r.flagged).toBe(false);
  });

  it("uses a multiple of the previous total for clips with little history", () => {
    expect(detectViewAnomaly(h(500), { day: "2026-01-02", views: 900 }, cfg).flagged).toBe(false);
    expect(detectViewAnomaly(h(500), { day: "2026-01-02", views: 20000 }, cfg).flagged).toBe(true);
  });

  it("never flags a non-advancing day or a decrease", () => {
    expect(detectViewAnomaly(h(1000, 2000, 3000), { day: "2026-01-03", views: 99999 }, cfg).flagged).toBe(false);
    expect(detectViewAnomaly(h(1000, 2000, 3000), { day: "2026-01-04", views: 100 }, cfg).flagged).toBe(false);
  });
});
