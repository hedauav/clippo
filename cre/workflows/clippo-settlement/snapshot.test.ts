// Run: node --experimental-strip-types --test workflows/clippo-settlement/snapshot.test.ts   (from cre/)
// Shared fixture with the backend contract test (web/src/lib/snapshots.contract.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeSnapshot } from "./snapshot.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/snapshot-feed.json", import.meta.url), "utf8"));

test("normalizeSnapshot turns the backend feed into the canonical string every node agrees on", () => {
  assert.equal(normalizeSnapshot(fx.backendFeed), fx.normalized);
});

test("rows with non-numeric (internal cuid) campaign ids are dropped", () => {
  const out = JSON.parse(normalizeSnapshot([...fx.backendFeed, { campaignId: "cmabc123", creator: fx.backendFeed[0].creator, cumulativeViews: 9 }]));
  assert.equal(out.length, 3);
});

import { assertFresh, chunkRows, parseFrozenFeed } from "./snapshot.ts";

test("empty feed normalises to []", () => {
  assert.equal(normalizeSnapshot([]), "[]");
});

test("normalisation is order-independent and keeps the highest duplicate", () => {
  const shuffled = [...fx.backendFeed].reverse();
  shuffled.push({ ...fx.backendFeed[0], cumulativeViews: 10 });
  assert.equal(normalizeSnapshot(shuffled), fx.normalized);
});

test("parseFrozenFeed accepts the envelope and rejects malformed ones", () => {
  assert.deepEqual(parseFrozenFeed({ day: "2026-10-27", hash: "ab", rows: [] }).rows, []);
  assert.throws(() => parseFrozenFeed([]));
  assert.throws(() => parseFrozenFeed({ day: "yesterday", rows: [] }));
  assert.throws(() => parseFrozenFeed({ day: "2026-10-27", rows: {} }));
});

test("assertFresh: yesterday ok, too old and future rejected", () => {
  const now = new Date("2026-10-28T00:30:00Z");
  assertFresh("2026-10-27", now, 2);
  assertFresh("2026-10-26", now, 2);
  assert.throws(() => assertFresh("2026-10-25", now, 2), /stale/);
  assert.throws(() => assertFresh("2026-10-29", now, 2), /future/);
});

test("chunkRows splits large batches", () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);
  const c = chunkRows(rows, 50);
  assert.deepEqual(c.map((x) => x.length), [50, 50, 20]);
  assert.deepEqual(chunkRows([], 50), []);
  assert.throws(() => chunkRows(rows, 0));
});
