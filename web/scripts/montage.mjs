// Contact sheet of shoot-senior screenshots so a whole device class can be reviewed in one image.
// Usage: node scripts/montage.mjs --tag r1 --device i14 --theme light [--kind fold|full] [--cols 6] [--cell 300] [--out file.png]
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const tag = arg("--tag", "r1"), device = arg("--device", "i14"), theme = arg("--theme", "light"), kind = arg("--kind", "fold");
const cols = Number(arg("--cols", "6")), cell = Number(arg("--cell", "300"));
const dir = resolve(here, "../../design/shots/senior", tag);
const files = readdirSync(dir).filter((f) => f.includes(`__${device}__${theme}__${kind}.png`));
const cellH = Number(arg("--cellh", String(Math.round(cell * 1.7))));
const html = `<body style="margin:0;background:#888;font:11px monospace;display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:6px;padding:6px;width:max-content">${files
  .map((f) => `<figure style="margin:0;background:#fff"><figcaption>${f.split("__")[0]}</figcaption><img src="${pathToFileURL(join(dir, f)).href}" style="width:${cell}px;height:${cellH}px;object-fit:contain;object-position:top;display:block;background:#ccc"></figure>`)
  .join("")}</body>`;
const exe = process.env.CHROMIUM_PATH;
const b = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const p = await b.newPage({ viewport: { width: cols * (cell + 6) + 12, height: 400 } });
const tmp = join(process.env.TEMP ?? ".", `montage-${Date.now()}.html`);
(await import("node:fs")).writeFileSync(tmp, html);
await p.goto(pathToFileURL(tmp).href);
await p.waitForTimeout(800);
const out = arg("--out", join(dir, `_montage-${device}-${theme}-${kind}.png`));
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out, files.length);
