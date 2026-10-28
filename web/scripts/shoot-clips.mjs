import { chromium } from "playwright-core";
const OUT = "../design/shots/clips";
const b = await chromium.launch({ executablePath: "C:/Users/anish/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
for (const rm of ["no-preference", "reduce"]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: rm });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3217/", { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const band = p.locator(".cb").first();
  await band.scrollIntoViewIfNeeded();
  await p.waitForTimeout(3500);
  const st = await p.evaluate(() => [...document.querySelectorAll("video.lc-vid")].map((v) => ({
    src: v.currentSrc.split("/").pop(), paused: v.paused, t: +v.currentTime.toFixed(2), rs: v.readyState, w: v.videoWidth, err: v.error?.code ?? null,
  })));
  const playing = st.filter((s) => !s.paused && s.t > 0).length;
  console.log(rm, "videos", st.length, "playing", playing, "loaded", st.filter((s) => s.w > 0).length, "errors", st.filter((s) => s.err).length);
  console.log(JSON.stringify(st.slice(0, 4)));
  await p.screenshot({ path: `${OUT}/band-${rm}.png` });
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/hero-${rm}.png` });
  await ctx.close();
}
await b.close();
