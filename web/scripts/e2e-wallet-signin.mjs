// Wallet connect e2e. Usage: node scripts/e2e-wallet-signin.mjs [--base http://localhost:3217]
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

// 1) two wallets -> picker -> pick -> role sheet (new wallet) -> signed in, with chain config returning 503
{
  const { ctx, page, account, calls } = await newPage([{ name: "Alpha" }, { name: "Beta" }]);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByTestId("wallet-picker").waitFor({ timeout: 5000 });
  check("picker lists both wallets", (await page.getByTestId("wallet-picker").getByRole("button", { name: /Alpha|Beta/ }).count()) === 2);
  await page.getByTestId("wallet-picker").getByRole("button", { name: "Beta" }).click();
  await page.getByRole("dialog", { name: /Which desk/ }).waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: /I clip: creator/ }).click();
  await page.locator("button.wallet", { hasText: account.address.slice(0, 6) }).waitFor({ timeout: 8000 });
  const u = (await me(page)).user;
  check("session cookie set, /api/auth/me returns the wallet", u?.wallet === account.address.toLowerCase(), JSON.stringify(u?.role));
  check("only the chosen wallet was used", calls.every((c) => c.startsWith("Beta:")), calls.join(","));
  check("no chain add/switch during connect", !calls.some((c) => /Ethereum(Chain)/.test(c)));
  await ctx.close();
}

// 2) wallet rejects the connection -> readable message, not silent
{
  const { ctx, page } = await newPage([{ name: "Solo", mode: "reject" }]);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  const dlg = page.getByRole("alertdialog");
  await dlg.waitFor({ timeout: 8000 });
  check("rejection shows a readable error", /rejected the request in your wallet/.test(await dlg.innerText()));
  await ctx.close();
}

// 3) no wallet -> install sheet
{
  const { ctx, page } = await newPage([]);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  const pick = page.getByTestId("wallet-picker");
  await pick.waitFor({ timeout: 5000 });
  check("no wallet shows install links", /No wallet found/.test(await pick.innerText()) && (await pick.getByRole("link").count()) >= 3);
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all wallet sign-in checks passed");
process.exit(failed ? 1 : 0);
