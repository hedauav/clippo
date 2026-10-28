// Device-emulated screenshot + design audit harness. Usage:
// node scripts/shoot-senior.mjs --tag before --devices se,ipad-l --routes /wire,/desk --themes light,dark --shots fold,full [--audit]
import { chromium, webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:3217");
const TAG = arg("--tag", "before");
const OUT = resolve(here, "../../design/shots/senior", TAG);
mkdirSync(OUT, { recursive: true });
const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_AND = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const UA_IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const D = {
  fold: [280, 653, 3, true, UA_AND], se: [375, 667, 2, true, UA_IOS], i14: [390, 844, 3, true, UA_IOS], pixel: [412, 915, 2.625, true, UA_AND],
  "land-phone": [844, 390, 3, true, UA_IOS], "ipad-p": [768, 1024, 2, true, UA_IPAD], "ipad-l": [1024, 768, 2, true, UA_IPAD], "ipad-pro": [1024, 1366, 2, true, UA_IPAD],
  mba13: [1280, 800, 2, false], mba13b: [1440, 900, 2, false], mbp14: [1512, 982, 2, false], mbp16: [1728, 1117, 2, false], imac24: [2240, 1260, 2, false],
  win125: [1536, 864, 1.25, false], win150: [1280, 720, 1.5, false],
  z200: [640, 360, 2, false], laptop: [1366, 768, 1, false], desk: [1440, 900, 1, false], fhd: [1920, 1080, 1, false], uw: [2560, 1080, 1, false], uw2: [3440, 1440, 1, false],
};
// Real ids from `node scripts/seed-demo.mjs`: pass --cid/--hire/--share/--list (defaults are placeholders that render the empty state).
const CID = arg("--cid", "cmvqkj2u9000o5abof7ibc9xt"), HIRE = arg("--hire", "x"), SHARE = arg("--share", "w"), LIST = arg("--list", "w");
const ROUTES = ["/", "/wire", `/slips/${CID}`, "/desk", "/desk/new", `/desk/${CID}/fund`, "/join", "/ledger", "/bench", "/account", "/hire", "/hire/brief", `/hire/lists/${LIST}`, `/hire/w/${HIRE}`, `/hire/share/${SHARE}`, "/status", "/referrals", "/profile"];
const devs = arg("--devices", Object.keys(D).join(",")).split(",");
const routes = arg("--routes", "") ? arg("--routes").split(",") : ROUTES;
const themes = arg("--themes", "light,dark").split(",");
const shots = arg("--shots", "").split(",").filter(Boolean);
const audit = process.argv.includes("--audit");
const WALLET = arg("--wallet", ""), ROLE = arg("--role", "CAMPAIGNER"); // dev sign-in (NODE_ENV != production) so signed-in states render
const zoom = Number(arg("--zoom", "1"));

const probe = () => {
  const vw = innerWidth, vh = innerHeight;
  const out = { vw, vh, docH: document.documentElement.scrollHeight, tinyText: [], smallTap: [], narrow: [], fixed: [], wrapW: 0, bodyFontMin: 99 };
  const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || el.closest(".sr,script,style,svg")) continue;
    const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const fs = parseFloat(cs.fontSize);
    const mono = /mono|Martian|Consolas/i.test(cs.fontFamily);
    if (fs < (mono ? 11.5 : 14)) { const k = el.tagName + "." + el.className + fs; if (!seen.has(k)) { seen.add(k); out.tinyText.push(`${fs.toFixed(1)}px ${mono ? "mono " : ""}${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${t.slice(0, 24)}"`); } }
  }
  for (const el of document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button]")) {
    const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (el.closest(".sr,.skip,.ticket,.x-drop") && el.type !== "text") continue;
    if (Math.min(r.width, r.height) < 40 && !(el.tagName === "A" && cs.display === "inline" )) out.smallTap.push(`${Math.round(r.width)}x${Math.round(r.height)} ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} "${(el.textContent || el.placeholder || "").trim().slice(0, 20)}"`);
  }
  for (const el of document.querySelectorAll("main *")) {
    const cs = getComputedStyle(el); if (cs.display === "none") continue;
    if (["P", "H1", "H2", "H3", "LI", "TD", "DD", "B"].includes(el.tagName)) {
      const r = el.getBoundingClientRect(); const t = (el.textContent || "").trim();
      if (r.width && r.width < 110 && t.length > 14 && r.height > 50 && vw > 300) out.narrow.push(`${Math.round(r.width)}px ${el.tagName.toLowerCase()} "${t.slice(0, 28)}"`);
    }
  }
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if ((cs.position === "fixed" || cs.position === "sticky") && cs.display !== "none") { const r = el.getBoundingClientRect(); if (r.height > 4 && !el.matches("body::before")) out.fixed.push(`${cs.position} ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)} top:${Math.round(r.top)}`); }
  }
  const m = document.querySelector("main .wrap, main"); if (m) { const cr = m.getBoundingClientRect(); const pad = parseFloat(getComputedStyle(m).paddingLeft) || 0; out.wrapW = Math.round(cr.width - pad * 2); }
  const h1 = document.querySelector("main h1"); if (h1) out.h1 = Math.round(parseFloat(getComputedStyle(h1).fontSize));
  out.bodyPx = parseFloat(getComputedStyle(document.body).fontSize);
  out.tiny = out.tinyText.length; out.tinyText = out.tinyText.slice(0, 8); out.smallTapN = out.smallTap.length; out.smallTap = out.smallTap.slice(0, 8);
  out.fixed = out.fixed.slice(0, 4); out.narrow = out.narrow.slice(0, 4);
  return out;
};

const ENGINE = arg("--engine", "chromium");
const exe = process.env.CHROMIUM_PATH ?? (ENGINE === "chromium" ? "C:/Users/anish/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe" : undefined);
const browser = await (ENGINE === "webkit" ? webkit : chromium).launch({ headless: true, ...(exe && ENGINE === "chromium" ? { executablePath: exe } : {}) });
const report = [];
for (const d of devs) {
  const [w, h, dsf, touch, ua] = D[d];
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: shots.length ? Math.min(dsf, 2) : 1, hasTouch: touch, isMobile: touch, userAgent: ua, colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem("clippo-theme", t); } catch {} }, theme);
    if (WALLET) { const r = await ctx.request.post(BASE + "/api/auth/session", { data: ROLE === "ADMIN" ? { wallet: WALLET } : { wallet: WALLET, role: ROLE } }); if (!r.ok()) console.log("sign-in failed", r.status()); }
    const page = await ctx.newPage();
    for (const route of routes) {
      const slug = (route === "/" ? "home" : route.slice(1).replace(/\//g, "_")) + `__${d}__${theme}`;
      try {
        await page.goto(BASE + route, { waitUntil: "load", timeout: 90000 });
        await page.waitForTimeout(1100);
        if (zoom !== 1) await page.evaluate((z) => { document.documentElement.style.zoom = z; }, zoom);
        await page.evaluate(() => document.fonts?.ready);
        if (audit) { const r = await page.evaluate(probe); report.push({ d, theme, route, ...r }); }
        if (shots.includes("fold")) await page.screenshot({ path: join(OUT, slug + "__fold.png") });
        if (shots.includes("full")) await page.screenshot({ path: join(OUT, slug + "__full.png"), fullPage: true });
      } catch (e) { console.log("ERR", d, theme, route, String(e.message).split("\n")[0]); }
    }
    await ctx.close();
  }
}
await browser.close();
if (audit) writeFileSync(join(OUT, "audit.json"), JSON.stringify(report, null, 1));
console.log("done", report.length);
