// Persistent headed browser. Drop job*.mjs files into WT_JOBS (export default async (ctx)=>{}); output -> WT_JOBS/out.log
import * as L from "./lib.mjs";
import { readdirSync, renameSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const jobs = process.env.WT_JOBS; mkdirSync(jobs, { recursive: true });
const out = (...a) => appendFileSync(join(jobs, "out.log"), a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
const browser = await L.launchHeaded();
const s = L.loadState();
const keys = { admin: process.env.ADMIN_PRIVATE_KEY, campaigner: s.campaigner, creator: s.creator, creator2: s.creator2 };
const sessions = {};
const ctx = { L, browser, out, keys, sessions,
  async as(role) { return (sessions[role] ??= await L.walletPage(browser, keys[role], role)); },
  async plain(name) { return (sessions[name] ??= await (async () => { const c = await browser.newContext({ viewport: null }); const page = await c.newPage(); await page.addInitScript(L.BANNER_INIT); return { ctx: c, page, issues: [] }; })()); } };
out("runner ready");
for (;;) {
  const f = readdirSync(jobs).filter((x) => /^job.*\.mjs$/.test(x)).sort()[0];
  if (!f) { await L.sleep(1000); continue; }
  const run = join(jobs, "done-" + f + "-" + Date.now() + ".mjs");
  renameSync(join(jobs, f), run);
  out("=== " + f);
  try { await (await import(pathToFileURL(run).href)).default(ctx); out("=== done " + f); } catch (e) { out("ERROR " + String(e?.stack ?? e).slice(0, 800)); }
}
