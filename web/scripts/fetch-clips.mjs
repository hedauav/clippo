// Fetch free stock clips (no API key, no account), compress to short muted portrait loops.
// Usage: node scripts/fetch-clips.mjs [--force]            build the 12 curated Mixkit clips
//        node scripts/fetch-clips.mjs --wikimedia "query"  list CC0/PD/CC BY(-SA) Commons videos (no download)
// Idempotent: clips already present in manifest.json (with files on disk) are skipped.
// Source: Mixkit "Stock Video Free License" (https://mixkit.co/license/#videoFree): free commercial use, no attribution required.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "clips");
const MAX_BYTES = 700 * 1024;
const W = 360, H = 640, SECS = 5;
const UA = "Mozilla/5.0 (compatible; ClippoSampleFetcher/1.0)";
const LICENSE_NAME = "Mixkit Stock Video Free License";
const LICENSE_URL = "https://mixkit.co/license/#videoFree";
const force = process.argv.includes("--force");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Curated, verified Mixkit items (all carry the Free licence, none "Restricted"). cx = horizontal crop anchor 0..1, ss = start second.
const CURATED = [
  { id: 4550, slug: "vlogger-recording-in-sign-language", title: "Vlogger recording in sign language", cx: 0.1 },
  { id: 5053, slug: "fitness-influencer-in-front-of-a-camera-giving-a-tutorial", title: "Fitness influencer in front of a camera giving a tutorial", cx: 0.3 },
  { id: 5052, slug: "person-is-filmed-exercising-with-a-cell-phone", title: "Person is filmed exercising with a cell phone" },
  { id: 50406, slug: "a-smartphone-is-recording-a-brunette-woman-applying-skincare-products", title: "A smartphone is recording a woman applying skincare products" },
  { id: 41273, slug: "youtuber-editing-a-video", title: "Youtuber editing a video" },
  { id: 41292, slug: "man-editing-a-video-on-his-computer", title: "Man editing a video on his computer" },
  { id: 2948, slug: "people-recording-a-podcast-in-a-studio", title: "People recording a podcast in a studio" },
  { id: 44050, slug: "recording-a-video-podcast", title: "Recording a video podcast" },
  { id: 51614, slug: "a-young-man-with-a-streaming-microphone-over-the-desktop", title: "A young man with a streaming microphone over the desktop", cx: 0.85 },
  { id: 44056, slug: "young-man-making-a-video-of-a-watch", title: "Young man making a video of a watch" },
  { id: 44069, slug: "young-man-recording-with-a-camera-on-a-set", title: "Young man recording with a camera on a set" },
  { id: 1512, slug: "professional-video-camera-on-a-tripod-recording-a-talk", title: "Professional video camera on a tripod recording a talk" },
];

async function wikimediaSearch(q) {
  const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch="
    + encodeURIComponent(`${q} filetype:video`) + "&prop=imageinfo&iiprop=url|size|extmetadata";
  const j = await (await fetch(u, { headers: { "User-Agent": UA } })).json();
  for (const p of Object.values(j.query?.pages || {})) {
    const i = p.imageinfo?.[0];
    const m = i?.extmetadata;
    const lic = m?.LicenseShortName?.value || "";
    if (!i || !/^(CC0|Public domain|CC BY)/i.test(lic)) continue;
    console.log(`${p.title} | ${i.width}x${i.height} | ${lic} | ${(m.Artist?.value || "").replace(/<[^>]*>/g, "")} | ${i.descriptionurl}\n  ${i.url}`);
  }
}

async function download(url, dest) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status === 429 || r.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    if (!r.ok) throw new Error(`download ${r.status}`);
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return;
  }
  throw new Error("download retries exhausted");
}

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });

function encode(src, n, { ss = 1, cx = 0.5 }) {
  const vf = `scale=-2:${H},crop=${W}:${H}:(iw-${W})*${cx}:0,fps=24,setsar=1`;
  const base = ["-ss", String(ss), "-i", src, "-t", String(SECS), "-an", "-vf", vf];
  const mp4 = path.join(OUT, `c${n}.mp4`), webm = path.join(OUT, `c${n}.webm`), jpg = path.join(OUT, `c${n}.jpg`);
  let mp4Size = 0, webmSize = 0;
  for (const crf of [22, 25, 28, 31, 34, 37, 40]) {
    ff([...base, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
    mp4Size = fs.statSync(mp4).size;
    if (mp4Size <= MAX_BYTES) break;
  }
  for (const crf of [28, 31, 34, 37, 40, 43, 46]) {
    ff([...base, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", webm]);
    webmSize = fs.statSync(webm).size;
    if (webmSize <= MAX_BYTES) break;
  }
  ff(["-ss", String(ss + 1), "-i", src, "-frames:v", "1", "-vf", vf, "-q:v", "5", jpg]);
  return { mp4Size, webmSize, posterSize: fs.statSync(jpg).size };
}

function writeLicenses(clips) {
  const lines = [
    "# Sample footage credits", "",
    `All sample clips are free stock videos from [Mixkit](https://mixkit.co) under the [${LICENSE_NAME}](${LICENSE_URL})`,
    "(free for commercial and personal projects, no attribution required; credited here anyway). Mixkit does not publish individual",
    "contributor names for these items, so the author is listed as Mixkit. Each was cropped to portrait, shortened to a muted loop and re-encoded.",
    "Generated by `scripts/fetch-clips.mjs`; do not edit by hand.", "",
    "| File | Title | Author | License | Source page |", "|---|---|---|---|---|",
    ...clips.map((c) => `| c${c.n} | ${c.title} | ${c.author} | [${c.license}](${c.licenseUrl}) | ${c.sourceUrl} |`), "",
  ];
  fs.writeFileSync(path.join(OUT, "LICENSES.md"), lines.join("\n"));
}

function writeManifest(clips) {
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ source: "Mixkit", license: LICENSE_URL, clips }, null, 2));
}

async function main() {
  const wm = process.argv.indexOf("--wikimedia");
  if (wm > -1) return wikimediaSearch(process.argv[wm + 1] || "video");

  fs.mkdirSync(OUT, { recursive: true });
  let prev = [];
  if (!force) {
    try { prev = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8")).clips || []; } catch { /* fresh */ }
  }
  const clips = prev.filter((c) => c.sourceId && ["mp4", "webm", "jpg"].every((e) => fs.existsSync(path.join(OUT, `c${c.n}.${e}`))));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clippo-clips-"));
  try {
    for (const [idx, item] of CURATED.entries()) {
      const n = idx + 1;
      if (clips.some((c) => c.n === n && c.sourceId === item.id)) continue;
      const url = `https://assets.mixkit.co/videos/${item.id}/${item.id}-720.mp4`;
      const src = path.join(tmp, `${item.id}.mp4`);
      console.log(`c${n}: ${item.title} (${url})`);
      await download(url, src);
      const sizes = encode(src, n, item);
      fs.rmSync(src, { force: true });
      const i = clips.findIndex((c) => c.n === n);
      if (i > -1) clips.splice(i, 1);
      clips.push({
        n, title: item.title, sourceId: item.id, sourceUrl: `https://mixkit.co/free-stock-video/${item.slug}-${item.id}/`,
        downloadUrl: url, author: "Mixkit", license: LICENSE_NAME, licenseUrl: LICENSE_URL,
        label: "Sample footage", duration: SECS, width: W, height: H, ...sizes,
      });
      clips.sort((a, b) => a.n - b.n);
      writeManifest(clips); // resumable
      console.log(`  mp4 ${(sizes.mp4Size / 1024).toFixed(0)}KB webm ${(sizes.webmSize / 1024).toFixed(0)}KB poster ${(sizes.posterSize / 1024).toFixed(0)}KB`);
      await sleep(1000); // be polite
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  writeManifest(clips);
  writeLicenses(clips);
  console.log(`Done: ${clips.length}/${CURATED.length} clips in ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
