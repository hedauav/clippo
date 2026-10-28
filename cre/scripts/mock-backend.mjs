#!/usr/bin/env node
// Local mock of the Clippo backend's frozen daily feed (GET /api/snapshots/daily) for `cre workflow simulate`.
// Serves the shared fixture (workflows/clippo-settlement/fixtures/snapshot-feed.json) in the same envelope as
// web/src/lib/snapshots.ts: { day, hash, rows }.  `day` defaults to yesterday (UTC), like the real backend.
// Usage: node scripts/mock-backend.mjs [--port 8787] [--mode fixture|empty|stale|large|bump] [--large-rows 60]
//   fixture  the shared fixture (default)
//   empty    rows: []            (workflow must no-op)
//   stale    day = 5 days ago    (workflow must reject)
//   large    --large-rows N synthetic rows on campaigns 7 and 12 (workflow must batch)
//   bump     fixture with views +100 on the first row (simulates the next day's snapshot)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(flag("port", process.env.PORT ?? 8787));
const mode = flag("mode", process.env.MOCK_MODE ?? "fixture");
const fixture = JSON.parse(readFileSync(new URL("../workflows/clippo-settlement/fixtures/snapshot-feed.json", import.meta.url), "utf8"));
const dayOffset = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function build() {
  let rows = fixture.backendFeed;
  let day = dayOffset(1);
  if (mode === "empty") rows = [];
  if (mode === "stale") day = dayOffset(5);
  if (mode === "bump") rows = rows.map((r, i) => (i === 0 ? { ...r, cumulativeViews: r.cumulativeViews + 100 } : r));
  if (mode === "large") {
    const n = Number(flag("large-rows", 60));
    rows = Array.from({ length: n }, (_, i) => ({
      campaignId: i % 2 ? "12" : "7",
      creator: "0x" + (0x1000 + i).toString(16).padStart(40, "0"),
      cumulativeViews: 100 + i,
    }));
  }
  return { day, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), rows };
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== "/api/snapshots/daily") { res.writeHead(404).end("not found"); return; }
  const body = build();
  console.log(`[mock-backend] ${req.method} ${req.url} -> day=${body.day} rows=${body.rows.length} mode=${mode}`);
  res.writeHead(200, { "content-type": "application/json", etag: `"${body.hash}"` }).end(JSON.stringify(body));
}).listen(port, "127.0.0.1", () => console.log(`[mock-backend] listening on http://127.0.0.1:${port} mode=${mode}`));
