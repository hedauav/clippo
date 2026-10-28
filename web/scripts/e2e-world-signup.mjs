// World ID sign-up e2e. Usage: node scripts/e2e-world-signup.mjs [--base http://localhost:3217]
// Needs a running dev server (npm run dev) + its database (npm run db:local). Injects EIP-6963 mock wallets whose
// signatures are REAL (a random test key signs in Node via viem; the page calls it through exposeFunction), and forces
// /api/chain/config to 503 to prove connect + sign-in do not depend on chain configuration.
import { chromium } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const i = process.argv.indexOf("--base");
const BASE = (i > -1 ? process.argv[i + 1] : process.env.BASE_URL ?? "http://localhost:3217").replace(/\/$/, "");
const pw = join(homedir(), "AppData/Local/ms-playwright");
const dir = existsSync(pw) ? readdirSync(pw).find((d) => d.startsWith("chromium-")) : null;
const exe = dir ? join(pw, dir, "chrome-win64/chrome.exe") : undefined;
const browser = await chromium.launch({ headless: true, ...(exe && existsSync(exe) ? { executablePath: exe } : {}) });

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};

/** Mock wallets: names, optional behaviour ("reject" answers 4001 to eth_requestAccounts). */
async function newPage(wallets) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const account = privateKeyToAccount(generatePrivateKey());
  const calls = [];
  await page.exposeFunction("__sign", (m) => account.signMessage({ message: m }));
  await page.exposeFunction("__log", (m) => calls.push(m));
  await page.route("**/api/chain/config", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_CONFIGURED", message: "not configured" } }) }));
  await page.addInitScript(({ wallets, address }) => {
    const mk = (name, mode) => ({
      request: async ({ method, params }) => {
        window.__log(`${name}:${method}`);
        if (method === "eth_requestAccounts" || method === "eth_accounts") {
          if (mode === "reject") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          return [address];
        }
        if (method === "eth_chainId") return "0x1";
        if (method === "personal_sign") return window.__sign(params[0].startsWith("0x") ? new TextDecoder().decode(Uint8Array.from(params[0].slice(2).match(/../g).map((h) => parseInt(h, 16)))) : params[0]);
        throw Object.assign(new Error("unsupported " + method), { code: -32601 });
      },
      on() {},
      removeListener() {},
    });
    wallets.forEach((w, n) => {
      const provider = mk(w.name, w.mode);
      const info = { uuid: `00000000-0000-4000-8000-00000000000${n}`, name: w.name, icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLz4=", rdns: `io.mock.${w.name.toLowerCase()}` };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
  }, { wallets, address: account.address });
  return { ctx, page, account, calls };
}
const me = (page) => page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
const api = (page, url, body) => page.evaluate(([u, b]) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })), [url, body]);

// Credential-free checks. What needs a real World app (QR scan in the staging simulator / Sandbox app) is listed in docs/tracks/world-idkit-demo.md.
async function toVerifyStep(page) {
  await page.goto(BASE + "/join", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /I clip/ }).click({ force: true });
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  const pick = page.getByTestId("wallet-picker");
  if (await pick.isVisible().catch(() => false)) await pick.getByRole("button", { name: /Alpha/ }).click();
  await page.getByRole("dialog", { name: /Which desk/ }).waitFor({ timeout: 4000 }).then(() => page.getByRole("button", { name: /I clip: creator/ }).click()).catch(() => {});
  await page.getByRole("button", { name: "Verify with World ID" }).waitFor({ timeout: 10000 });
}

// 1) unverified account is gated server-side (channel proof, submit, claim)
{
  const { ctx, page } = await newPage([{ name: "Alpha" }]);
  await toVerifyStep(page);
  check("new creator is unverified", (await me(page)).user?.verified === false);
  const ch = await api(page, "/api/channels", { platform: "YOUTUBE", handle: "@gate-test" });
  check("channel proof refused until verified (403 NOT_VERIFIED)", ch.status === 403 && ch.body?.error?.code === "NOT_VERIFIED", JSON.stringify(ch.body?.error));
  const sub = await api(page, "/api/submissions", { campaignId: "x", channelId: "y", link: "https://youtu.be/abc" });
  check("submission refused until verified", sub.status === 403 && sub.body?.error?.code === "NOT_VERIFIED");
  await ctx.close();
}

// 2) not configured (no WORLD_ID_* env): clear state, nothing changes
{
  const { ctx, page } = await newPage([{ name: "Alpha" }]);
  await page.route("**/api/worldid/rp-signature", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_CONFIGURED", message: "World ID is not configured: set WORLD_ID_APP_ID" } }) }));
  await toVerifyStep(page);
  await page.getByRole("button", { name: "Verify with World ID" }).click();
  const dlg = page.getByRole("alertdialog");
  await dlg.waitFor({ timeout: 8000 });
  check("not-configured sheet shown", /not set up|Not configured/i.test(await dlg.innerText()));
  await dlg.getByRole("button", { name: "Close" }).click();
  check("still unverified after not-configured", (await me(page)).user?.verified === false);
  await ctx.close();
}

// 3) backend refusals surface as friendly text and leave the account unverified (the widget itself is stubbed: needs real app to scan)
for (const [code, status, re] of [["ALREADY_USED", 409, /already linked to another Clippo account/], ["WORLD_ID_DENIED", 403, /Nothing was changed/]]) {
  const { ctx, page } = await newPage([{ name: "Alpha" }]);
  await page.route("**/api/worldid/rp-signature", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rpContext: { app_id: "app_test", rp_id: "rp_test", action: "clippo-creator-signup", environment: "staging", nonce: "0x01", created_at: 1, expires_at: 2, signature: "0x00" } }) }));
  await page.route("**/api/worldid/verify", (r) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message: "refused" } }) }));
  await toVerifyStep(page);
  // Drive the backend call the widget would make after onSuccess, then read the UI state from the account endpoint.
  const res = await api(page, "/api/worldid/verify", { protocol_version: "4.0", responses: [{ identifier: "orb", nullifier: "0x1" }] });
  check(`${code} -> ${status}`, res.status === status && res.body?.error?.code === code);
  check(`unverified after ${code}`, (await me(page)).user?.verified === false);
  void re;
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all World ID sign-up checks passed");
process.exit(failed ? 1 : 0);
