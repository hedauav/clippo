// Walkthrough harness: real Chromium + injected EIP-1193 wallet signing in Node via viem (keys never reach the page).
import { chromium } from "playwright-core";
import { createPublicClient, createWalletClient, defineChain, http, parseUnits, formatUnits, parseAbi } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const BASE = process.env.BASE_URL ?? "http://localhost:3417";
export const SHOTS = new URL("../../../design/shots/walkthrough/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
export const STATE = process.env.WT_STATE;
export const chain = defineChain({ id: Number(process.env.ARC_CHAIN_ID), name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC_URL] } } });
export const pub = createPublicClient({ chain, transport: http(process.env.ARC_RPC_URL) });
export const USDC = "0x3600000000000000000000000000000000000000";
export const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
export const U = (n) => parseUnits(String(n), 6);
export const fmt = (n) => formatUnits(n, 6);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
export const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
export const newKey = generatePrivateKey;
export const acct = (k) => privateKeyToAccount(k);

export async function launch() {
  const pw = join(homedir(), "AppData/Local/ms-playwright");
  const dir = readdirSync(pw).filter((d) => d.startsWith("chromium-")).sort().pop();
  const exe = join(pw, dir, "chrome-win64/chrome.exe");
  return chromium.launch({ headless: true, ...(existsSync(exe) ? { executablePath: exe } : {}) });
}

/** New browser context whose window.ethereum is a wallet for `privateKey`. Returns { ctx, page, issues }. */
export async function walletPage(browser, privateKey, label) {
  const account = privateKeyToAccount(privateKey);
  const wc = createWalletClient({ account, chain, transport: http(process.env.ARC_RPC_URL) });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const issues = [];
  page.on("console", (m) => { if (m.type() === "error") issues.push(`[${label}] console: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => issues.push(`[${label}] pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) issues.push(`[${label}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  page.on("requestfailed", (r) => issues.push(`[${label}] requestfailed ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  const txs = [];
  await page.exposeFunction("__rpc", async (method, params) => {
    switch (method) {
      case "personal_sign": {
        const m = params[0];
        const msg = m.startsWith("0x") ? Buffer.from(m.slice(2), "hex").toString("utf8") : m;
        return account.signMessage({ message: msg });
      }
      case "eth_sendTransaction": {
        const t = params[0];
        const hash = await wc.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined, gas: t.gas ? BigInt(t.gas) : undefined });
        txs.push(hash);
        return hash;
      }
      case "eth_requestAccounts": case "eth_accounts": return [account.address];
      case "wallet_switchEthereumChain": case "wallet_addEthereumChain": case "wallet_requestPermissions": return null;
      case "eth_chainId": return "0x" + chain.id.toString(16);
      case "net_version": return String(chain.id);
      default: return pub.request({ method, params });
    }
  });
  await page.addInitScript(BANNER_INIT);
  await page.addInitScript(() => {
    const p = { isMetaMask: true, request: async ({ method, params }) => window.__rpc(method, params ?? []), on() {}, removeListener() {} };
    window.ethereum = p;
  });
  return { ctx, page, issues, account, txs };
}
export const shot = (page, name) => page.screenshot({ path: SHOTS + name + ".png", fullPage: false });
export const api = (page, path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); let b; try { b = await r.json(); } catch { b = null; } return { status: r.status, body: b }; }, [path, init]);

/** Connect + SIWE sign-in through the real UI. `role` text chooses the new-wallet role button. */
export async function signIn(page, roleRe) {
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  const dlg = page.getByRole("dialog", { name: /Which desk/ });
  const hit = await Promise.race([dlg.waitFor({ timeout: 20000 }).then(() => "sheet"), page.getByRole("button", { name: /Signed in as/ }).waitFor({ timeout: 20000 }).then(() => "in")]).catch(() => "timeout");
  if (hit === "sheet") { await page.getByRole("button", { name: roleRe }).click(); await page.getByRole("button", { name: /Signed in as/ }).waitFor({ timeout: 20000 }); }
  return (await api(page, "/api/auth/me")).body?.user;
}

export async function launchHeaded() {
  const pw = join(homedir(), "AppData/Local/ms-playwright");
  const dir = readdirSync(pw).filter((d) => d.startsWith("chromium-")).sort().pop();
  const exe = join(pw, dir, "chrome-win64/chrome.exe");
  return chromium.launch({ headless: false, slowMo: 300, args: ["--window-size=1460,980", "--window-position=20,20"], ...(existsSync(exe) ? { executablePath: exe } : {}) });
}
/** Visible on-page banner (kept across navigations through sessionStorage). kind: "step" | "help" */
export async function banner(page, text, kind = "step") {
  await page.evaluate(([t, k]) => { try { sessionStorage.setItem("__wt", JSON.stringify([t, k])); } catch {} window.__wtDraw?.(); }, [text, kind]).catch(() => {});
}
export const BANNER_INIT = () => {
  window.__wtDraw = () => {
    let raw; try { raw = JSON.parse(sessionStorage.getItem("__wt") || "null"); } catch {}
    let el = document.getElementById("__wt");
    if (!raw) { el?.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "__wt"; document.documentElement.appendChild(el); }
    el.textContent = raw[0];
    el.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:${raw[1] === "help" ? "18px" : "6px"} 14px;font:${raw[1] === "help" ? "700 20px" : "600 13px"} system-ui;text-align:center;color:#fff;background:${raw[1] === "help" ? "#c2410c" : "#1d4ed8"};pointer-events:none;box-shadow:0 2px 8px #0006`;
  };
  document.addEventListener("DOMContentLoaded", () => window.__wtDraw());
  setInterval(() => window.__wtDraw(), 1000);
};
/** Pause for a human: big orange banner, poll every 5s up to 10 min until predicate() is truthy. */
export async function waitForUser(page, message, predicate, minutes = 10) {
  await banner(page, "HELP NEEDED: " + message, "help");
  await page.bringToFront().catch(() => {});
  const end = Date.now() + minutes * 60000;
  while (Date.now() < end) {
    if (await predicate().catch(() => false)) { await banner(page, "Thanks, continuing...", "step"); return true; }
    await sleep(5000);
  }
  await banner(page, "Timed out waiting for the user; continuing", "step");
  return false;
}
