// Responsive overflow check. Usage: node scripts/check-overflow.mjs [--base http://localhost:3000] [--shots] [--widths 320,360] [--routes /wire,/desk]
// Fails (exit 1) if, for any route x width x theme, the document scrolls horizontally OR any element pokes outside
// the viewport (html/body use overflow-x: clip, so scrollWidth alone cannot be trusted).
// Needs a running server (npm run dev / npm start) and a Chromium that playwright-core can launch.
import { chromium } from "playwright-core";
import { readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const BASE = arg("--base", process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WIDTHS = arg("--widths", "280,320,360,390,430,600,768,820,844,1024,1280,1440,1920,2560,3440").split(",").map(Number);
const THEMES = ["light", "dark"];
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = resolve(here, "../../design/shots/responsive");

// Sample values for dynamic segments.
const SAMPLE = { id: "c-ledgerlane", token: "w" };
function discover() {
  const root = join(here, "../src/app/(site)");
  const out = ["/"];
  const walk = (dir, segs) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, [...segs, f]);
      else if (f === "page.tsx") out.push("/" + segs.map((s) => s.replace(/^\[(\w+)\]$/, (_, n) => SAMPLE[n] ?? "x")).join("/"));
    }
  };
  walk(root, []);
  return [...new Set(out)];
}
const ROUTES = arg("--routes", "") ? arg("--routes", "").split(",") : discover();

const probe = () => {
  const vw = window.innerWidth;
  const de = document.documentElement;
  const res = { scrollWidth: Math.max(de.scrollWidth, document.body.scrollWidth), vw, offenders: [] };
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== de; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o !== "visible") return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (el.closest(".sr, .skip, svg defs, [aria-hidden='true'] .ticker-track") || el.classList.contains("sr")) continue;
    if (r.right > vw + 1 || r.left < -1) {
      if (clipped(el)) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      res.offenders.push(`${el.tagName.toLowerCase()}${cls ? "." + cls.trim().split(/\s+/).join(".") : ""} [${Math.round(r.left)}..${Math.round(r.right)}] "${(el.textContent || "").trim().slice(0, 30)}"`);
    }
  }
  res.offenders = res.offenders.slice(0, 6);
  return res;
};

const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const failures = [];
let checked = 0;
if (SHOTS && !existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
for (const theme of THEMES) {
  for (const w of WIDTHS) {
    const h = w < 500 ? 800 : w < 1000 ? 1000 : 900;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w < 1024, isMobile: false });
    await ctx.addInitScript((t) => { try { localStorage.setItem("clippo-theme", t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      for (let attempt = 0; attempt < 3; attempt++) try {
        await page.goto(BASE + route, { waitUntil: "load", timeout: 60000 });
        await page.waitForTimeout(350);
        await page.evaluate(() => document.fonts?.ready);
        const r = await page.evaluate(probe);
        checked++;
        const bad = r.scrollWidth > r.vw || r.offenders.length > 0;
        if (bad) failures.push({ route, w, theme, ...r });
        if (SHOTS && theme === "light" && [320, 390, 768, 1280, 2560].includes(w)) {
          await page.screenshot({ path: join(SHOT_DIR, `${route === "/" ? "home" : route.slice(1).replace(/\//g, "_")}-${w}-${theme}.png`), fullPage: true });
        }
      } catch (e) {
        failures.push({ route, w, theme, error: String(e.message ?? e).split("\n")[0] });
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`checked ${checked} page/width/theme combinations across ${ROUTES.length} routes: ${ROUTES.join(" ")}`);
if (failures.length) {
  for (const f of failures) {
    console.log(`FAIL ${f.theme} ${f.w}px ${f.route}: ` + (f.error ? f.error : `scrollWidth ${f.scrollWidth} > ${f.vw}? ${f.scrollWidth > f.vw}; offenders: ${f.offenders.join(" | ")}`));
  }
  console.log(`${failures.length} failure(s)`);
  process.exit(1);
}
console.log("PASS: no horizontal overflow");
