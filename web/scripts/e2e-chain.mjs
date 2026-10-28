// `npm run e2e:chain` - LOCAL end-to-end money-flow test. No external credentials.
//
// Boots everything itself on free ports: anvil (chain id 31337) -> deploys the REAL contracts with the REAL Deploy.s.sol
// (+ DeployMock.s.sol for USDC) -> in-memory PGlite Postgres + prisma migrations -> `next dev` with env pointing at anvil and
// CLIPPO_E2E_DOUBLES=1 (src/instrumentation.ts: explicit TEST doubles for World ID / AI / YouTube, refused in production).
// Then it plays the PRD flows with real transactions and real HTTP calls, asserting USDC balances exactly after every step.
// Requires foundry (forge, anvil) on PATH: export PATH="$HOME/.foundry/bin:$PATH".
//
// Env: E2E_ANVIL_PORT / E2E_WEB_PORT / E2E_PG_PORT (else free ports), E2E_KEEP=1 (leave servers running at the end).
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, openSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  parseAbi,
  parseEventLogs,
  parseUnits,
  formatUnits,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { startLocalPg } from "./pg-local-lib.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const contractsDir = path.resolve(webDir, "../contracts");
const U = (n) => parseUnits(String(n), 6);
const fmt = (n) => formatUnits(n, 6);
const MNEMONIC = "test test test test test test test test test test test junk"; // anvil default
const acct = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const lc = (a) => a.toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = {
  deployer: acct(0),
  admin: acct(1),
  treasury: acct(2),
  updater: acct(3),
  campaigner1: acct(4),
  campaigner2: acct(5),
  creatorA: acct(6),
  creatorB: acct(7),
};
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil account 0 (public test key)
const WF_OWNER = acct(8).address; // CRE workflow owner expected by the receiver
const FORWARDER = "0x00000000000000000000000000000000000f0f0d"; // no private key: impersonated, like the CRE KeystoneForwarder

/* ------------------------------------------------------------------ results */
const results = [];
let currentScenario = "setup";
class StepFailed extends Error {}
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ scenario: currentScenario, step: name, status: "PASS", detail: typeof detail === "string" ? detail : "" });
    console.log(`  PASS  ${name}${typeof detail === "string" && detail ? `  (${detail})` : ""}  [${Date.now() - t0}ms]`);
  } catch (e) {
    const msg = String(e?.message ?? e).split("\n").slice(0, 3).join(" | ");
    results.push({ scenario: currentScenario, step: name, status: "FAIL", detail: msg });
    console.log(`  FAIL  ${name}\n        ${msg}`);
    throw new StepFailed(msg);
  }
}
async function scenario(name, fn) {
  currentScenario = name;
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof StepFailed)) {
      results.push({ scenario: name, step: "(unexpected)", status: "FAIL", detail: String(e?.stack ?? e).slice(0, 300) });
      console.log(`  FAIL  (unexpected) ${e?.stack ?? e}`);
    }
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function eq(actual, expected, label) {
  const a = typeof actual === "bigint" ? actual.toString() : JSON.stringify(actual);
  const b = typeof expected === "bigint" ? expected.toString() : JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

/* ------------------------------------------------------------------ infra */
async function freePort(preferred) {
  const tryPort = (p) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
  if (preferred && (await tryPort(preferred))) return preferred;
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 30000);
    if (await tryPort(p)) return p;
  }
  throw new Error("no free port");
}

const children = [];
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}
const foundryEnv = { ...process.env, PATH: `${process.env.HOME ?? os.homedir()}/.foundry/bin${path.delimiter}${process.env.PATH}` };

async function waitFor(fn, label, timeoutMs = 120_000, everyMs = 500) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`timeout waiting for ${label}${last ? `: ${last.message}` : ""}`);
}

/* ------------------------------------------------------------------ ABIs */
// ABIs straight from the forge artifacts (fresh after the deploy script compiled them)
const artifactAbi = (n) => JSON.parse(readFileSync(path.join(contractsDir, `out/${n}.sol/${n}.json`), "utf8")).abi;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
  "function decimals() view returns (uint8)",
]);

/* ------------------------------------------------------------------ main */
let escrowAbi, receiverAbi;
const logDir = mkdtempSync(path.join(os.tmpdir(), "clippo-e2e-"));
const controlFile = path.join(logDir, "control.json");
const ctl = { views: {}, gone: [] };
const writeCtl = () => writeFileSync(controlFile, JSON.stringify(ctl));
writeCtl();

let anvil, nextDev, pg;
async function cleanup() {
  if (process.env.E2E_KEEP === "1") return console.log(`\nE2E_KEEP=1: leaving servers up (logs in ${logDir})`);
  for (const c of children) killTree(c);
  try {
    await pg?.stop();
  } catch {
    /* ignore */
  }
}
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

async function main() {
  const anvilPort = await freePort(Number(process.env.E2E_ANVIL_PORT) || 8546);
  const pgPort = await freePort(Number(process.env.E2E_PG_PORT) || 0);
  const webPort = await freePort(Number(process.env.E2E_WEB_PORT) || 0);
  const rpc = `http://127.0.0.1:${anvilPort}`;
  const base = `http://127.0.0.1:${webPort}`;
  console.log(`logs: ${logDir}\nanvil ${rpc} (chain 31337) | postgres(PGlite) :${pgPort} | next dev ${base}`);

  /* ---- anvil ---- */
  anvil = spawn("anvil", ["--port", String(anvilPort), "--chain-id", "31337", "--silent"], { env: foundryEnv, stdio: ["ignore", openSync(path.join(logDir, "anvil.log"), "w"), "inherit"] });
  children.push(anvil);
  anvil.on("error", (e) => console.error("anvil failed to start (is foundry on PATH?)", e.message));
  const chain = defineChain({ id: 31337, name: "Anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  await waitFor(async () => (await pub.getChainId()) === 31337, "anvil");
  const wallet = (account) => createWalletClient({ account, chain, transport: http(rpc) });

  /* ---- deploy: DeployMock.s.sol (USDC) then Deploy.s.sol with ALLOW_ANY_CHAIN ---- */
  const forge = async (script, env) => {
    const { stdout } = await run("forge", ["script", script, "--rpc-url", rpc, "--private-key", DEPLOYER_KEY, "--broadcast"], {
      cwd: contractsDir,
      env: { ...foundryEnv, ...env },
      maxBuffer: 20_000_000,
    });
    return stdout;
  };
  escrowAbi = artifactAbi("ClippoEscrow");
  receiverAbi = artifactAbi("ClippoReportReceiver");
  const mockOut = await forge("script/DeployMock.s.sol", {});
  const usdc = mockOut.match(/MockUSDC\s+(0x[0-9a-fA-F]{40})/)?.[1];
  assert(usdc, "MockUSDC address not found in forge output");
  const depOut = await forge("script/Deploy.s.sol", {
    ALLOW_ANY_CHAIN: "true",
    ADMIN_ADDRESS: A.admin.address,
    FORWARDER_ADDRESS: FORWARDER,
    EXPECTED_WORKFLOW_OWNER: WF_OWNER, // strict receiver: metadata workflow owner is enforced (no INSECURE_SKIP_WORKFLOW_CHECK)
    INSECURE_SKIP_WORKFLOW_CHECK: "false",
    UPDATER_ADDRESS: A.updater.address,
    TREASURY_ADDRESS: A.treasury.address,
    USDC_ADDRESS: usdc,
  });
  const pick = (re) => depOut.match(re)?.[1];
  const addrs = {
    usdc,
    escrow: pick(/ClippoEscrow\s+(0x[0-9a-fA-F]{40})/),
    receiver: pick(/ClippoReportReceiver\s+(0x[0-9a-fA-F]{40})/),
    referral: pick(/ClippoReferral\s+(0x[0-9a-fA-F]{40})/),
    profile: pick(/ClippoCreatorProfile\s+(0x[0-9a-fA-F]{40})/),
    deployBlock: pick(/ESCROW_DEPLOY_BLOCK=(\d+)/),
  };
  for (const [k, v] of Object.entries(addrs)) assert(v, `deploy output missing ${k}`);
  console.log("deployed:", addrs);
  const { escrow, receiver } = addrs;

  /* ---- postgres + migrations ---- */
  pg = await startLocalPg({ port: pgPort });
  await run(process.execPath, [path.join(webDir, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: webDir, env: { ...process.env, DATABASE_URL: pg.url }, maxBuffer: 20_000_000 });

  /* ---- next dev with the doubles switch ---- */
  const serverEnv = {
    ...process.env,
    PORT: String(webPort),
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_DIST_DIR: ".next-e2e",
    DATABASE_URL: pg.url,
    SESSION_SECRET: "e2e-chain-session-secret",
    ADMIN_WALLETS: A.admin.address.toLowerCase(),
    CRON_SECRET: "e2e-cron-secret",
    ARC_RPC_URL: rpc,
    ARC_CHAIN_ID: "31337",
    USDC_ADDRESS: addrs.usdc,
    ESCROW_ADDRESS: escrow,
    ESCROW_DEPLOY_BLOCK: addrs.deployBlock,
    PROFILE_ADDRESS: addrs.profile,
    REFERRAL_ADDRESS: addrs.referral,
    REPORT_RECEIVER_ADDRESS: receiver,
    ANOMALY_MIN_DELTA: "1000000000", // view-spike detection is exercised by its own tests; keep it quiet here
    CLIPPO_E2E_DOUBLES: "1",
    E2E_CONTROL_FILE: controlFile,
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
    YOUTUBE_API_KEY: "",
  };
  delete serverEnv.NODE_ENV;
  nextDev = spawn(process.execPath, [path.join(webDir, "node_modules/next/dist/bin/next"), "dev", "-p", String(webPort)], {
    cwd: webDir,
    env: serverEnv,
    stdio: ["ignore", openSync(path.join(logDir, "next.log"), "w"), openSync(path.join(logDir, "next.err.log"), "w")],
  });
  children.push(nextDev);
  let nextExited = false;
  nextDev.on("exit", () => (nextExited = true));
  await waitFor(async () => {
    if (nextExited) throw new Error(`next dev exited; see ${path.join(logDir, "next.log")}`);
    const r = await fetch(`${base}/api/chain/config`, { signal: AbortSignal.timeout(170_000) });
    return r.ok;
  }, "next dev", 240_000, 1500);

  /* ---- http + chain helpers ---- */
  async function api(method, p, { token, json } = {}) {
    const res = await fetch(`${base}/api${p}`, {
      method,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(170_000),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
  const okApi = async (method, p, opts, expect = [200, 201, 202]) => {
    const r = await api(method, p, opts);
    if (!expect.includes(r.status)) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body;
  };
  const errCode = async (method, p, opts, status, code) => {
    const r = await api(method, p, opts);
    if (r.status !== status || (code && r.body?.error?.code !== code)) throw new Error(`${method} ${p}: expected ${status} ${code ?? ""}, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };

  const rnd = () => Math.random().toString(16).slice(2, 12);
  async function signIn(account, role) {
    const n = await okApi("GET", "/auth/nonce");
    const message = createSiweMessage({ address: account.address, chainId: n.chainId, domain: n.domain, nonce: n.nonce, uri: n.uri, version: "1", statement: n.statement, issuedAt: new Date(), expirationTime: new Date(n.expiresAt) });
    const signature = await account.signMessage({ message });
    const r = await okApi("POST", "/auth/session", { json: { message, signature, ...(role ? { role } : {}) } });
    return { token: r.token, user: r.user };
  }
  const proof = () => ({ nullifier_hash: `0x${rnd()}${rnd()}`, proof: `proof-${rnd()}` });

  const send = async (account, address, abi, functionName, args) => {
    const hash = await wallet(account).writeContract({ address, abi, functionName, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    assert(rc.status === "success", `${functionName} reverted`);
    return { hash, rc };
  };
  const expectRevert = async (fn, name, label) => {
    try {
      await fn();
    } catch (e) {
      const m = `${e.shortMessage ?? ""} ${e.message ?? ""} ${e.details ?? ""}`;
      if (!m.includes(name)) throw new Error(`${label}: reverted but not with ${name}: ${m.slice(0, 200)}`);
      return;
    }
    throw new Error(`${label}: expected revert ${name} but it succeeded`);
  };
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
  const chainNow = async () => Number((await pub.getBlock()).timestamp);
  const warp = async (secs) => {
    await pub.request({ method: "evm_increaseTime", params: [secs] });
    await pub.request({ method: "evm_mine", params: [] });
  };
  const DAY = 86400;

  /* ---- exact USDC ledger ---- */
  const exp = new Map();
  const track = (addr) => (exp.has(lc(addr)) || exp.set(lc(addr), 0n), lc(addr));
  const move = (from, to, amt) => {
    exp.set(track(from), exp.get(track(from)) - amt);
    exp.set(track(to), exp.get(track(to)) + amt);
  };
  const names = new Map([[lc(escrow), "escrow"], ...Object.entries(A).map(([k, v]) => [lc(v.address), k])]);
  let feesExpected = 0n; // treasuryAccrued + withdrawn
  let feesWithdrawn = 0n;
  async function checkBalances(label) {
    for (const addr of [escrow, ...Object.values(A).map((a) => a.address)]) track(addr);
    for (const [addr, want] of exp) {
      const got = await read(usdc, erc20Abi, "balanceOf", [addr]);
      if (got !== want) throw new Error(`USDC balance (${label}) ${names.get(addr) ?? addr}: expected ${fmt(want)}, got ${fmt(got)}`);
    }
    const accrued = await read(escrow, escrowAbi, "treasuryAccrued");
    eq(accrued, feesExpected - feesWithdrawn, `treasuryAccrued (${label})`);
  }
  const mintTo = async (to, amt) => {
    await send(A.deployer, usdc, erc20Abi, "mint", [to, amt]);
    exp.set(track(to), exp.get(track(to)) + amt);
  };
  const campaignerFee = (gross) => (gross * 25n) / 10_000n;
  const creatorFee = (gross) => (gross * 25n) / 10_000n;

  /* ---- domain helpers ---- */
  const sessions = {};
  const login = async (key, role) => (sessions[key] = await signIn(A[key], role));

  async function signupCreator(key, handle) {
    const s = await login(key, "CREATOR");
    await okApi("POST", "/worldid/verify", { token: s.token, json: proof() });
    const ch = (await okApi("POST", "/channels", { token: s.token, json: { platform: "YOUTUBE", handle } })).channel;
    await okApi("POST", `/channels/${ch.id}/verify`, { token: s.token, json: {} });
    s.channelId = ch.id;
    return s;
  }
  async function createDraft(key, body) {
    return (await okApi("POST", "/campaigns", { token: sessions[key].token, json: body })).campaign;
  }
  const story = {
    summary: "Create short clips promoting: our workflow automation product",
    topic: "workflow automation product",
    requiredPoints: ["Explain the workflow", "Show the product"],
    prohibitedClaims: ["guaranteed results"],
    disclosureLabel: "#ad",
    attribution: "Credit the original creator",
  };
  /** Pays campaignerFee + creates the campaign on-chain from the campaigner wallet, then asks the backend to verify the receipt. */
  async function fundCampaign(key, c) {
    const acc = A[key];
    const p = await okApi("GET", `/campaigns/${c.id}/fund`, { token: sessions[key].token });
    const a = p.createCampaignArgs;
    const gross = BigInt(a.poolAmount);
    const deadline = BigInt(Math.max(a.deadline, (await chainNow()) + 30 * DAY));
    const escBefore = await read(usdc, erc20Abi, "balanceOf", [escrow]);
    await send(acc, usdc, erc20Abi, "approve", [escrow, gross]);
    const { hash } = await send(acc, escrow, escrowAbi, "createCampaign", [a.mode, BigInt(a.ratePer1kViews), gross, deadline, a.requireAdminApproval, a.metadataURI]);
    move(acc.address, escrow, gross);
    await checkBalances(`${c.title} funded`);
    eq(await read(usdc, erc20Abi, "balanceOf", [escrow]), escBefore + gross, "escrow got the gross pool");
    const res = await okApi("POST", `/campaigns/${c.id}/fund`, { token: sessions[key].token, json: { txHash: hash } });
    assert(res.verified && res.campaign.status === "FUNDED", "backend did not mark the campaign FUNDED");
    assert(/^\d+$/.test(res.campaign.onchainId ?? ""), "no onchainId");
    eq(res.campaign.campaignerFee, Number(fmt(campaignerFee(gross))), "DB campaignerFee");
    return { ...res.campaign, onchainId: BigInt(res.campaign.onchainId), gross, deadline, preview: p.preview };
  }
  /** Admin approves on-chain (attestation for high-value) then tells the backend. */
  async function adminApprove(c, attestation) {
    const args = attestation ? [c.onchainId, attestation] : [c.onchainId];
    await send(A.admin, escrow, escrowAbi, "approveCampaign", args);
    feesExpected += campaignerFee(c.gross); // withheld fee accrues to the treasury on approval
    await checkBalances(`${c.title} approved`);
    const r = await okApi("POST", `/campaigns/${c.id}/approve`, { token: sessions.admin.token, json: {} });
    eq(r.campaign.status, "APPROVED", "DB status after approve");
  }
  // Each clip gets its own transcript so the duplicate-content check (exact/near) does not reject clips of the same campaign.
  const uniqueTranscript = (id) =>
    `Hey everyone, today I want to talk about this product and why it changed my workflow. This video is Sponsored. Credit to the original creator. ${Array.from({ length: 40 }, (_, i) => `w${id}x${i}${rnd()}`).join(" ")}`;
  async function submitClip(key, campaignId, videoId, expectResult = "APPROVE") {
    const r = await okApi("POST", "/submissions", { token: sessions[key].token, json: { campaignId, channelId: sessions[key].channelId, link: `https://youtu.be/${videoId}?mock_transcript=${encodeURIComponent(uniqueTranscript(videoId))}` } });
    eq(r.verdict.result, expectResult, `verdict for ${videoId}`);
    return r.submission;
  }
  const refresh = () => okApi("POST", "/snapshots/refresh", { token: sessions.admin.token, json: {} });
  const feed = async () => await okApi("GET", "/snapshots/latest");
  /** Delivers rows through ClippoReportReceiver.onReport exactly as the KeystoneForwarder would (impersonated). */
  async function deliver(rows, workflowOwner = WF_OWNER) {
    await pub.request({ method: "anvil_impersonateAccount", params: [FORWARDER] });
    await pub.request({ method: "anvil_setBalance", params: [FORWARDER, "0xde0b6b3a7640000"] });
    const report = encodeAbiParameters(
      [{ type: "tuple[]", components: [{ name: "campaignId", type: "uint256" }, { name: "creator", type: "address" }, { name: "cumulativeViews", type: "uint256" }] }],
      [rows.map((r) => ({ campaignId: BigInt(r.campaignId), creator: r.creator, cumulativeViews: BigInt(r.cumulativeViews) }))],
    );
    // KeystoneForwarder metadata: workflowId(32) | workflowName(10) | workflowOwner(20) | reportId(2)
    const metadata = `0x${"11".repeat(32)}${"22".repeat(10)}${workflowOwner.slice(2).toLowerCase()}0001`;
    const hash = await createWalletClient({ account: FORWARDER, chain, transport: http(rpc) }).writeContract({ address: receiver, abi: receiverAbi, functionName: "onReport", args: [metadata, report] });
    const rc = await pub.waitForTransactionReceipt({ hash });
    assert(rc.status === "success", "onReport tx reverted");
    const logs = parseEventLogs({ abi: [...receiverAbi, ...escrowAbi], logs: rc.logs });
    return { hash, logs, processed: logs.find((l) => l.eventName === "ReportProcessed")?.args, reported: logs.filter((l) => l.eventName === "ViewsReported").map((l) => l.args), failed: logs.filter((l) => l.eventName === "ItemFailed") };
  }
  const feedRows = async (onchainId) => (await feed()).filter((r) => BigInt(r.campaignId) === onchainId);
  const sync = () => okApi("POST", "/chain/sync", { token: sessions.admin.token, json: {} });
  const payoutsOf = async (key) => (await okApi("GET", "/creator/earnings", { token: sessions[key].token })).payouts;
  const payoutFor = async (key, campaignDbId) => (await payoutsOf(key)).find((p) => p.campaignId === campaignDbId);
  const campaignStatus = async (id) => (await okApi("GET", `/campaigns/${id}`, { token: sessions.admin.token })).campaign.status;

  /* ---- initial funds + sanity of the deployment ---- */
  currentScenario = "0. deployment";
  console.log(`\n== ${currentScenario}`);
  await step("contracts deployed with expected wiring (owner=admin, forwarder, adapter, fees, retention)", async () => {
    eq((await read(escrow, escrowAbi, "owner")).toLowerCase(), lc(A.admin.address), "escrow owner");
    assert(await read(escrow, escrowAbi, "isAdmin", [A.admin.address]), "admin flag");
    assert(!(await read(escrow, escrowAbi, "isAdmin", [A.deployer.address])), "deployer admin right revoked");
    eq((await read(escrow, escrowAbi, "reportAdapter")).toLowerCase(), lc(receiver), "reportAdapter");
    eq((await read(receiver, receiverAbi, "forwarder")).toLowerCase(), FORWARDER, "receiver forwarder");
    eq((await read(escrow, escrowAbi, "treasury")).toLowerCase(), lc(A.treasury.address), "treasury");
    eq(await read(escrow, escrowAbi, "retentionPeriod"), BigInt(7 * DAY), "retentionPeriod");
    eq(Number(await read(escrow, escrowAbi, "campaignerFeeBps")), 25, "campaignerFeeBps");
    for (const [n, a] of [["referral", addrs.referral], ["profile", addrs.profile]]) assert((await pub.getCode({ address: a }))?.length > 2, `${n} has code`);
    const cfg = await okApi("GET", "/chain/config");
    eq(cfg.chain.chainId, 31337, "backend chainId");
    eq(lc(cfg.chain.escrow), lc(escrow), "backend escrow");
    eq(cfg.fees.source, "chain", "fees read from chain");
    return `escrow ${escrow}`;
  });
  await step("test doubles are active only via the explicit switch (World ID double accepts a proof)", async () => {
    await login("admin");
    const r = await api("POST", "/worldid/verify", { token: sessions.admin.token, json: proof() });
    assert(r.status === 200 && r.body.mode === "test", `expected world id test mode, got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  });
  await step("mint test USDC to campaigners; all balances exact", async () => {
    await mintTo(A.campaigner1.address, U(10_000));
    await mintTo(A.campaigner2.address, U(10_000));
    await checkBalances("minted");
  });

  /* ====================================================== S1: PER_VIEW */
  const S1 = "1. PER_VIEW (wizard -> fund -> approve -> report -> retention -> claim -> close)";
  await scenario(S1, async () => {
    let c, vidA = "e2eviewsa1";
    await step("campaigner SIWE sign-in (CAMPAIGNER) + wizard suggests a story", async () => {
      const s = await login("campaigner1", "CAMPAIGNER");
      eq(lc(s.user.wallet), lc(A.campaigner1.address), "wallet");
      const w = await okApi("POST", "/wizard/suggest", { token: s.token, json: { idea: "workflow automation", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW" } });
      assert(w.story?.topic && w.suggestions?.length, "wizard returned a story + pool suggestions");
      return `aiMode=${w.aiMode}`;
    });
    await step("create DRAFT campaign (pool 100 USDC, 10 USDC / 1k views)", async () => {
      c = await createDraft("campaigner1", { title: "E2E per-view", story, contentSource: "LINK", contentUrl: "https://example.com/source", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", poolSize: 100, ratePer1k: 10 });
      eq(c.status, "DRAFT", "status");
    });
    await step("fund preview fee == on-chain fee; createCampaign on-chain (approve+create); backend verifies receipt", async () => {
      const prev = await okApi("GET", `/campaigns/${c.id}/fund`, { token: sessions.campaigner1.token });
      eq(prev.preview.campaignerFee, 0.25, "preview fee");
      eq(prev.preview.netPool, 99.75, "preview net pool");
      c = await fundCampaign("campaigner1", c);
      eq(c.highValue, false, "highValue");
      const on = await read(escrow, escrowAbi, "getCampaign", [c.onchainId]);
      eq(on.pool, U(99.75), "on-chain pool");
      eq(on.state, 1, "state Funded");
    });
    await step("replayed fund call is idempotent; funding a 2nd time is refused", async () => {
      const again = await okApi("POST", `/campaigns/${c.id}/fund`, { token: sessions.campaigner1.token, json: { txHash: (await okApi("GET", `/campaigns/${c.id}`, { token: sessions.campaigner1.token })).campaign.fundTxHash } });
      assert(again.verified, "idempotent replay");
      await errCode("POST", `/campaigns/${c.id}/fund`, { token: sessions.campaigner1.token, json: { txHash: "0x" + "12".repeat(32) } }, 409, "BAD_STATE");
    });
    await step("backend refuses approve before the on-chain approve (409 CHAIN_STATE_MISMATCH); non-admin 403", async () => {
      await errCode("POST", `/campaigns/${c.id}/approve`, { token: sessions.admin.token, json: {} }, 409, "CHAIN_STATE_MISMATCH");
      await errCode("POST", `/campaigns/${c.id}/approve`, { token: sessions.campaigner1.token, json: {} }, 403, "FORBIDDEN");
      await expectRevert(() => send(A.campaigner1, escrow, escrowAbi, "approveCampaign", [c.onchainId]), "NotAdmin", "non-admin approve");
    });
    await step("admin on-chain approve -> treasury accrues the campaigner fee; backend verifies", async () => {
      await adminApprove(c);
      eq(await campaignStatus(c.id), "APPROVED", "status");
    });
    await step("creator A signs up (SIWE + World ID double), proves channel, submits clip -> verdict APPROVE", async () => {
      await signupCreator("creatorA", "e2e-creator-a");
      await submitClip("creatorA", c.id, vidA);
    });
    await step("snapshots: refresh -> GET /api/snapshots/latest carries {onchainId, wallet, 4000}", async () => {
      ctl.views[vidA] = 4000;
      writeCtl();
      const r = await refresh();
      eq(r.updated, 1, "refresh updated");
      const rows = await feedRows(c.onchainId);
      eq(rows, [{ campaignId: c.onchainId.toString(), creator: lc(A.creatorA.address), cumulativeViews: 4000 }], "feed rows");
    });
    await step("receiver auth: a non-forwarder (NotForwarder) and a foreign workflow owner (InvalidWorkflowOwner) are refused", async () => {
      await expectRevert(() => send(A.creatorA, receiver, receiverAbi, "onReport", ["0x", "0x"]), "NotForwarder", "onReport by stranger");
      const rowsNow = await feedRows(c.onchainId);
      const badMeta = `0x${"11".repeat(32)}${"22".repeat(10)}${A.creatorB.address.slice(2).toLowerCase()}0001`;
      const badReport = encodeAbiParameters([{ type: "tuple[]", components: [{ name: "campaignId", type: "uint256" }, { name: "creator", type: "address" }, { name: "cumulativeViews", type: "uint256" }] }], [rowsNow.map((r) => ({ campaignId: BigInt(r.campaignId), creator: r.creator, cumulativeViews: BigInt(r.cumulativeViews) }))]);
      await expectRevert(() => pub.simulateContract({ account: FORWARDER, address: receiver, abi: receiverAbi, functionName: "onReport", args: [badMeta, badReport] }), "InvalidWorkflowOwner", "report from a foreign workflow owner");
      await expectRevert(() => pub.simulateContract({ account: FORWARDER, address: receiver, abi: receiverAbi, functionName: "onReport", args: ["0x", badReport] }), "BadMetadata", "report without workflow metadata");
    });
    await step("report #1 via receiver as forwarder: credits 40 USDC (4000 views), escrow state exact", async () => {
      const d = await deliver(await feedRows(c.onchainId));
      eq(d.processed.failed, 0n, "failed items");
      eq(d.reported[0].credited, U(40), "ViewsReported.credited");
      eq(await read(escrow, escrowAbi, "reportedViews", [c.onchainId, A.creatorA.address]), 4000n, "reportedViews");
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorA.address]), U(40), "credited");
      eq((await read(escrow, escrowAbi, "getCampaign", [c.onchainId])).allocated, U(40), "allocated");
      await checkBalances("after report #1 (reports move no USDC)");
    });
    await step("indexer: sync creates the payout (40 USDC, releaseAt = block time + 7d); rerun is idempotent", async () => {
      const s1 = await sync();
      assert(s1.applied >= 1, `sync applied something ${JSON.stringify(s1)}`);
      const p = await payoutFor("creatorA", c.id);
      eq(p.amount, 40, "DB payout amount");
      eq(p.status, "PENDING", "payout status");
      const b = (await pub.getBlock()).timestamp;
      assert(new Date(p.releaseAt).getTime() / 1000 > Number(b) + 6 * DAY, "releaseAt ~ 7d after credit");
      const s2 = await sync();
      eq(s2.applied, 0, "second sync applies nothing");
    });
    await step("claim inside the retention window reverts on-chain (NothingToClaim); balances unchanged", async () => {
      await expectRevert(() => send(A.creatorA, escrow, escrowAbi, "claim", [c.onchainId]), "NothingToClaim", "early claim");
      eq(await read(escrow, escrowAbi, "claimable", [c.onchainId, A.creatorA.address]), 0n, "claimable");
      await checkBalances("early claim refused");
    });
    await step("report #2 (7000 views): only the delta (3000 -> +30 USDC) is credited", async () => {
      ctl.views[vidA] = 7000;
      writeCtl();
      await refresh();
      const d = await deliver(await feedRows(c.onchainId));
      eq(d.reported[0].deltaViews, 3000n, "deltaViews");
      eq(d.reported[0].credited, U(30), "credited delta");
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorA.address]), U(70), "credited total");
    });
    await step("duplicate report ignored (same cumulative) and stale report ignored (5000 < 7000)", async () => {
      const dup = await deliver(await feedRows(c.onchainId));
      eq(dup.reported[0].deltaViews, 0n, "dup delta");
      eq(dup.reported[0].credited, 0n, "dup credited");
      const stale = await deliver([{ campaignId: c.onchainId.toString(), creator: A.creatorA.address, cumulativeViews: 5000 }]);
      eq(stale.reported[0].credited, 0n, "stale credited");
      eq(stale.reported[0].cumulativeViews, 7000n, "stale keeps the high-water mark");
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorA.address]), U(70), "credited unchanged");
      eq(await read(escrow, escrowAbi, "reportedViews", [c.onchainId, A.creatorA.address]), 7000n, "reportedViews unchanged");
      await checkBalances("after dup/stale");
    });
    await step("a report for a missing campaign fails ONLY that item (ItemFailed), the rest of the batch lands", async () => {
      const d = await deliver([
        { campaignId: "999999", creator: A.creatorA.address, cumulativeViews: 1 },
        { campaignId: c.onchainId.toString(), creator: A.creatorA.address, cumulativeViews: 7000 },
      ]);
      eq(d.processed.items, 2n, "items");
      eq(d.processed.failed, 1n, "failed");
      eq(d.failed.length, 1, "ItemFailed events");
    });
    await step("campaigner cannot close before the deadline (DeadlineNotReached)", async () => {
      await expectRevert(() => send(A.campaigner1, escrow, escrowAbi, "closeCampaign", [c.onchainId]), "DeadlineNotReached", "early close");
    });
    await step("retention window passes (anvil +7d): creator claims 70 USDC gross -> fee 0.175, net 69.825", async () => {
      await warp(7 * DAY + 3600);
      eq(await read(escrow, escrowAbi, "claimable", [c.onchainId, A.creatorA.address]), U(70), "claimable");
      const gross = U(70);
      const fee = creatorFee(gross);
      const { hash } = await send(A.creatorA, escrow, escrowAbi, "claim", [c.onchainId]);
      move(escrow, A.creatorA.address, gross - fee);
      feesExpected += fee;
      await checkBalances("after claim");
      const p = await payoutFor("creatorA", c.id);
      const r = await okApi("POST", `/payouts/${p.id}/claim`, { token: sessions.creatorA.token, json: { txHash: hash } });
      eq(r.payout.status, "CLAIMED", "DB payout status");
      eq(r.payout.claimedAmount, 70, "DB claimedAmount");
      await errCode("POST", `/payouts/${p.id}/claim`, { token: sessions.creatorA.token, json: { txHash: hash } }, 409, "BAD_STATE");
      await expectRevert(() => send(A.creatorA, escrow, escrowAbi, "claim", [c.onchainId]), "NothingToClaim", "double claim");
    });
    await step("deadline passes; campaigner closes -> unspent 29.75 USDC returned; indexer/DB CLOSED", async () => {
      await warp(25 * DAY);
      const on = await read(escrow, escrowAbi, "getCampaign", [c.onchainId]);
      const refund = on.pool - on.allocated;
      eq(refund, U(29.75), "expected refund");
      const { hash } = await send(A.campaigner1, escrow, escrowAbi, "closeCampaign", [c.onchainId]);
      move(escrow, A.campaigner1.address, refund);
      await checkBalances("after close");
      await okApi("POST", `/campaigns/${c.id}/close`, { token: sessions.campaigner1.token, json: { txHash: hash } });
      eq(await campaignStatus(c.id), "CLOSED", "DB status");
      eq((await feedRows(c.onchainId)).length, 0, "closed campaign leaves the CRE feed");
    });
  });

  /* ====================================================== S2: HUMAN_SPLIT high value, two-party */
  const S2 = "2. HUMAN_SPLIT high-value, campaigner + admin approvals";
  await scenario(S2, async () => {
    let c, att;
    const proofApprove = proof();
    await step("create + fund 2000 USDC HUMAN_SPLIT (CAMPAIGNER_AND_ADMIN) -> flagged highValue (net 1995 > 1000)", async () => {
      await login("campaigner2", "CAMPAIGNER");
      c = await createDraft("campaigner2", { title: "E2E split", story, contentSource: "LINK", contentUrl: "https://example.com/source2", platforms: ["YOUTUBE"], payoutMode: "HUMAN_SPLIT", approver: "CAMPAIGNER_AND_ADMIN", poolSize: 2000 });
      c = await fundCampaign("campaigner2", c);
      eq(c.highValue, true, "DB highValue");
      eq(c.preview.highValue, true, "preview highValue");
      eq((await read(escrow, escrowAbi, "getCampaign", [c.onchainId])).requireAdminApproval, true, "requireAdminApproval");
    });
    await step("high-value approve WITHOUT attestation reverts on-chain (AttestationRequired)", async () => {
      await expectRevert(() => send(A.admin, escrow, escrowAbi, "approveCampaign", [c.onchainId]), "AttestationRequired", "approve w/o attestation");
    });
    await step("admin human confirmation: denied proof 403, fresh proof ok, replayed proof 409 PROOF_REUSED", async () => {
      await errCode("POST", `/campaigns/${c.id}/attest`, { token: sessions.admin.token, json: { worldIdProof: { nullifier_hash: "0xdead", proof: "invalid" } } }, 403, "WORLD_ID_DENIED");
      const r = await okApi("POST", `/campaigns/${c.id}/attest`, { token: sessions.admin.token, json: { worldIdProof: proofApprove } });
      att = r.attestation;
      assert(/^0x[0-9a-f]{64}$/.test(att), "attestation is bytes32");
      eq(r.highValue, true, "highValue echoed");
      await errCode("POST", `/campaigns/${c.id}/attest`, { token: sessions.admin.token, json: { worldIdProof: proofApprove } }, 409, "PROOF_REUSED");
    });
    await step("admin approveCampaign(id, attestation) on-chain; backend verifies attestation matches (HumanAttested)", async () => {
      await adminApprove(c, att);
      eq((await read(escrow, escrowAbi, "approvalAttestation", [c.onchainId])).toLowerCase(), att.toLowerCase(), "on-chain attestation");
      eq(c.onchainId > 0n, true, "id");
    });
    
    await step("creators A and B have approved clips in the campaign", async () => {
      await signupCreator("creatorB", "e2e-creator-b");
      await submitClip("creatorA", c.id, "e2esplita1");
      await submitClip("creatorB", c.id, "e2esplitb1");
    });
    const split = () => [
      { creatorWallet: A.creatorA.address, amount: 1000 },
      { creatorWallet: A.creatorB.address, amount: 500 },
    ];
    const approveSplitOnChain = async (key, r) => {
      const a = r.onchain.args;
      return send(A[key], escrow, escrowAbi, "approveSplit", [BigInt(a.id), a.creators, a.amounts.map((x) => BigInt(x)), a.attestation]);
    };
    await step("API refuses splits above the pool (400 EXCEEDS_POOL) and recipients without an approved clip (400 BAD_RECIPIENT)", async () => {
      await errCode("POST", `/campaigns/${c.id}/split`, { token: sessions.campaigner2.token, json: { splits: [{ creatorWallet: A.creatorA.address, amount: 2000 }], worldIdProof: proof() } }, 400, "EXCEEDS_POOL");
      await errCode("POST", `/campaigns/${c.id}/split`, { token: sessions.campaigner2.token, json: { splits: [{ creatorWallet: A.updater.address, amount: 10 }], worldIdProof: proof() } }, 400, "BAD_RECIPIENT");
    });
    await step("campaigner approves split 1000/500 (fresh proof) -> PENDING, awaiting admin; on-chain credits NOTHING yet", async () => {
      const r = await okApi("POST", `/campaigns/${c.id}/split`, { token: sessions.campaigner2.token, json: { splits: split(), worldIdProof: proof() } });
      eq(r.proposal.status, "PENDING", "proposal status");
      eq(r.proposal.awaiting, ["admin"], "awaiting");
      await approveSplitOnChain("campaigner2", r);
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorA.address]), 0n, "nothing credited after one approval");
      await errCode("POST", `/campaigns/${c.id}/split`, { token: sessions.campaigner2.token, json: { splits: split(), worldIdProof: proof() } }, 409, "ALREADY_APPROVED");
      await checkBalances("after campaigner split approval");
    });
    await step("admin approves the identical split (fresh proof) -> AWAITING_CHAIN; on-chain finalises + credits", async () => {
      const r = await okApi("POST", `/campaigns/${c.id}/split`, { token: sessions.admin.token, json: { splits: [...split()].reverse(), worldIdProof: proof() } });
      eq(r.proposal.status, "AWAITING_CHAIN", "proposal status");
      await approveSplitOnChain("admin", r);
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorA.address]), U(1000), "A credited");
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorB.address]), U(500), "B credited");
      eq((await read(escrow, escrowAbi, "getCampaign", [c.onchainId])).allocated, U(1500), "allocated");
      await checkBalances("after split finalized (credits move no USDC)");
    });
    await step("indexer: SplitFinalized + CreatorCredited -> payouts 1000 / 500, proposal no longer pending", async () => {
      await sync();
      eq((await payoutFor("creatorA", c.id)).amount, 1000, "A payout");
      eq((await payoutFor("creatorB", c.id)).amount, 500, "B payout");
      eq((await payoutFor("creatorA", c.id)).releaseAt, null, "no retention for split payouts");
      eq((await okApi("GET", `/campaigns/${c.id}/split`, { token: sessions.campaigner2.token })).proposals.length, 0, "pending proposals");
    });
    await step("A and B claim (no retention for splits): fees 2.5 / 1.25 USDC to treasury, exact nets", async () => {
      for (const [key, amt] of [["creatorA", 1000n], ["creatorB", 500n]]) {
        const gross = U(amt);
        const fee = creatorFee(gross);
        const { hash } = await send(A[key], escrow, escrowAbi, "claim", [c.onchainId]);
        move(escrow, A[key].address, gross - fee);
        feesExpected += fee;
        await checkBalances(`${key} claimed`);
        const p = await payoutFor(key, c.id);
        const r = await okApi("POST", `/payouts/${p.id}/claim`, { token: sessions[key].token, json: { txHash: hash } });
        eq(r.payout.status, "CLAIMED", `${key} DB status`);
      }
    });
    await step("admin closes early: unallocated 495 USDC returned to the campaigner; backend CLOSED", async () => {
      const { hash } = await send(A.admin, escrow, escrowAbi, "closeCampaign", [c.onchainId]);
      move(escrow, A.campaigner2.address, U(495));
      await checkBalances("after close");
      await okApi("POST", `/campaigns/${c.id}/close`, { token: sessions.admin.token, json: { txHash: hash } });
      eq(await campaignStatus(c.id), "CLOSED", "status");
    });
  });

  /* ====================================================== S3: POOL_SHARE */
  const S3 = "3. POOL_SHARE (weights from views, distribution at close)";
  await scenario(S3, async () => {
    let c;
    const vA = "e2epoolaa1", vB = "e2epoolbb1";
    await step("create + fund 300 USDC POOL_SHARE (VIEWS); admin approves (non high-value)", async () => {
      c = await createDraft("campaigner1", { title: "E2E pool share", story, contentSource: "LINK", contentUrl: "https://example.com/source3", platforms: ["YOUTUBE"], payoutMode: "POOL_SHARE", poolShareBasis: "VIEWS", poolSize: 300 });
      c = await fundCampaign("campaigner1", c);
      eq(c.highValue, false, "highValue");
      await adminApprove(c);
    });
    await step("A and B submit clips; snapshots 3000 / 1000 views appear in the feed", async () => {
      await submitClip("creatorA", c.id, vA);
      await submitClip("creatorB", c.id, vB);
      ctl.views[vA] = 3000;
      ctl.views[vB] = 1000;
      writeCtl();
      await refresh();
      const rows = await feedRows(c.onchainId);
      eq(rows.map((r) => [r.creator, r.cumulativeViews]).sort(), [[lc(A.creatorA.address), 3000], [lc(A.creatorB.address), 1000]].sort(), "feed");
    });
    await step("a PER_VIEW report for a POOL_SHARE campaign is rejected by the escrow (BadMode) without blocking the batch", async () => {
      const d = await deliver(await feedRows(c.onchainId));
      eq(d.processed.failed, 2n, "both items failed");
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorA.address]), 0n, "nothing credited");
    });
    await step("campaigner sets weights 3000:1000 on-chain; stranger cannot (NotApprover)", async () => {
      await expectRevert(() => send(A.creatorA, escrow, escrowAbi, "setWeights", [c.onchainId, [A.creatorA.address], [1n]]), "NotApprover", "stranger setWeights");
      await send(A.campaigner1, escrow, escrowAbi, "setWeights", [c.onchainId, [A.creatorA.address, A.creatorB.address], [3000n, 1000n]]);
      eq(await read(escrow, escrowAbi, "totalWeight", [c.onchainId]), 4000n, "totalWeight");
    });
    let shareA, shareB;
    await step("deadline passes; campaigner closes: whole pool distributed 3:1, rounding dust refunded (exact)", async () => {
      await warp(31 * DAY);
      const pool = U(300) - campaignerFee(U(300));
      shareA = (pool * 3000n) / 4000n;
      shareB = (pool * 1000n) / 4000n;
      const refund = pool - shareA - shareB;
      const { hash } = await send(A.campaigner1, escrow, escrowAbi, "closeCampaign", [c.onchainId]);
      if (refund > 0n) move(escrow, A.campaigner1.address, refund);
      await checkBalances("after pool close");
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorA.address]), shareA, "A credited");
      eq(await read(escrow, escrowAbi, "credited", [c.onchainId, A.creatorB.address]), shareB, "B credited");
      await okApi("POST", `/campaigns/${c.id}/close`, { token: sessions.campaigner1.token, json: { txHash: hash } });
      eq(await campaignStatus(c.id), "CLOSED", "status");
    });
    await step("indexer credits payouts; both claim after close (creator-side fee floors like the contract)", async () => {
      await sync();
      eq((await payoutFor("creatorA", c.id)).amount, Number(fmt(shareA)), "A payout");
      for (const [key, share] of [["creatorA", shareA], ["creatorB", shareB]]) {
        const fee = creatorFee(share);
        const { hash } = await send(A[key], escrow, escrowAbi, "claim", [c.onchainId]);
        move(escrow, A[key].address, share - fee);
        feesExpected += fee;
        await checkBalances(`${key} pool claim`);
        const p = await payoutFor(key, c.id);
        const r = await okApi("POST", `/payouts/${p.id}/claim`, { token: sessions[key].token, json: { txHash: hash } });
        eq(r.payout.status, "CLAIMED", `${key} status`);
      }
    });
  });

  /* ====================================================== S4: rejection */
  const S4 = "4. Rejection with full refund";
  await scenario(S4, async () => {
    let c;
    await step("fund 100 USDC then admin rejects on-chain: campaigner refunded in full INCLUDING the fee", async () => {
      c = await createDraft("campaigner1", { title: "E2E rejected", story, contentSource: "LINK", contentUrl: "https://example.com/source4", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", poolSize: 100, ratePer1k: 5 });
      c = await fundCampaign("campaigner1", c);
      const before = await read(usdc, erc20Abi, "balanceOf", [A.campaigner1.address]);
      const { hash } = await send(A.admin, escrow, escrowAbi, "rejectCampaign", [c.onchainId]);
      move(escrow, A.campaigner1.address, U(100));
      await checkBalances("after reject");
      eq(await read(usdc, erc20Abi, "balanceOf", [A.campaigner1.address]), before + U(100), "refund == gross");
      const r = await okApi("POST", `/campaigns/${c.id}/reject`, { token: sessions.admin.token, json: { reason: "e2e: not allowed", txHash: hash } });
      eq(r.campaign.status, "REJECTED", "DB status");
    });
    await step("a rejected campaign cannot be approved/closed/reported/claimed; treasury got no fee", async () => {
      await expectRevert(() => send(A.admin, escrow, escrowAbi, "approveCampaign", [c.onchainId]), "BadState", "approve after reject");
      await expectRevert(() => send(A.admin, escrow, escrowAbi, "closeCampaign", [c.onchainId]), "BadState", "close after reject");
      await expectRevert(() => send(A.creatorA, escrow, escrowAbi, "claim", [c.onchainId]), "BadState", "claim after reject");
      await errCode("POST", `/campaigns/${c.id}/approve`, { token: sessions.admin.token, json: {} }, 409);
      await checkBalances("rejected stays settled");
    });
  });

  /* ====================================================== S5: fraud freeze */
  const S5 = "5. Claim frozen by fraud flag (deleted clip) refused at API";
  await scenario(S5, async () => {
    let c, vid = "e2efrozen01", p, flag;
    await step("fund 50 USDC PER_VIEW, approve, clip approved, 2000 views reported -> 20 USDC credited, payout synced", async () => {
      c = await createDraft("campaigner1", { title: "E2E frozen", story, contentSource: "LINK", contentUrl: "https://example.com/source5", platforms: ["YOUTUBE"], payoutMode: "PER_VIEW", poolSize: 50, ratePer1k: 10 });
      c = await fundCampaign("campaigner1", c);
      await adminApprove(c);
      await submitClip("creatorA", c.id, vid);
      ctl.views[vid] = 2000;
      writeCtl();
      await refresh();
      const d = await deliver(await feedRows(c.onchainId));
      eq(d.reported[0].credited, U(20), "credited");
      await sync();
      p = await payoutFor("creatorA", c.id);
      eq(p.amount, 20, "payout");
    });
    await step("clip deleted: refresh freezes the payout, opens a CLIP_DELETED flag, and drops the clip from the feed", async () => {
      ctl.gone = [vid];
      writeCtl();
      const r = await refresh();
      eq(r.deleted.length, 1, "deleted clips");
      p = await payoutFor("creatorA", c.id);
      eq(p.frozen, true, "payout frozen");
      eq((await feedRows(c.onchainId)).length, 0, "feed excludes the deleted clip");
      const q = await okApi("GET", "/admin/queue", { token: sessions.admin.token });
      flag = q.fraudFlags.find((f) => f.kind === "CLIP_DELETED" && f.campaignId === c.id);
      assert(flag, "admin queue shows the CLIP_DELETED flag");
    });
    await step("claim preview says frozen/not claimable; POST claim is refused 409 PAYOUT_FROZEN", async () => {
      const prev = await okApi("GET", `/payouts/${p.id}/claim`, { token: sessions.creatorA.token });
      eq(prev.frozen, true, "preview frozen");
      eq(prev.claimable, false, "preview claimable");
      await errCode("POST", `/payouts/${p.id}/claim`, { token: sessions.creatorA.token, json: { txHash: "0x" + "ab".repeat(32) } }, 409, "PAYOUT_FROZEN");
    });
    await step("admin DISMISSes the flag (clip public again) -> payout unfrozen", async () => {
      ctl.gone = [];
      writeCtl();
      await okApi("PATCH", `/admin/flags/${flag.id}`, { token: sessions.admin.token, json: { action: "DISMISS" } });
      p = await payoutFor("creatorA", c.id);
      eq(p.frozen, false, "payout unfrozen");
    });
    await step("pool cap: 5000 views would be +30 USDC but only the 29.875 left in the pool is credited (delta within cap)", async () => {
      ctl.views[vid] = 5000;
      writeCtl();
      await refresh();
      const d = await deliver(await feedRows(c.onchainId));
      eq(d.reported[0].deltaViews, 3000n, "deltaViews");
      eq(d.reported[0].credited, U(29.875), "credited is capped at the remaining pool");
      eq(await read(escrow, escrowAbi, "remainingPool", [c.onchainId]), 0n, "pool exhausted");
      // deliberately NO backend sync here: the claim below must still reconcile the DB (indexer catches up before applying Claimed)
    });
    await step("retention passes; claim 49.875 USDC on-chain (fee floors) and API records it fully; admin closes, refund 0", async () => {
      await warp(8 * DAY);
      const gross = U(49.875);
      const fee = creatorFee(gross);
      const { hash } = await send(A.creatorA, escrow, escrowAbi, "claim", [c.onchainId]);
      move(escrow, A.creatorA.address, gross - fee);
      feesExpected += fee;
      await checkBalances("frozen-then-released claim");
      const r = await okApi("POST", `/payouts/${p.id}/claim`, { token: sessions.creatorA.token, json: { txHash: hash } });
      eq(r.payout.status, "CLAIMED", "status");
      eq(r.payout.claimedAmount, 49.875, "DB claimedAmount covers the not-yet-synced 29.875");
      const on = await read(escrow, escrowAbi, "getCampaign", [c.onchainId]);
      const refund = on.pool - on.allocated;
      eq(refund, 0n, "refund (pool fully allocated)");
      const closed = await send(A.admin, escrow, escrowAbi, "closeCampaign", [c.onchainId]);
      await checkBalances("after close");
      await okApi("POST", `/campaigns/${c.id}/close`, { token: sessions.admin.token, json: { txHash: closed.hash } });
    });
  });

  /* ====================================================== S6: fees + conservation */
  await scenario("6. Fees land at the treasury; escrow fully drained", async () => {
    await step("withdrawFees (permissionless): treasury receives exactly campaigner + creator fees; escrow balance is 0", async () => {
      const accrued = await read(escrow, escrowAbi, "treasuryAccrued");
      eq(accrued, feesExpected, "treasuryAccrued == sum of all fees");
      await send(A.creatorB, escrow, escrowAbi, "withdrawFees", []);
      move(escrow, A.treasury.address, accrued);
      feesWithdrawn = accrued;
      await checkBalances("after withdrawFees");
      eq(await read(usdc, erc20Abi, "balanceOf", [A.treasury.address]), feesExpected, "treasury USDC == fees");
      const left = await read(usdc, erc20Abi, "balanceOf", [escrow]);
      if (left !== 0n) {
        const n = await read(escrow, escrowAbi, "campaignCount");
        for (let i = 1n; i <= n; i++) {
          const k = await read(escrow, escrowAbi, "getCampaign", [i]);
          console.log(`   campaign #${i}: state=${k.state} mode=${k.mode} pool=${fmt(k.pool)} allocated=${fmt(k.allocated)}`);
        }
      }
      eq(left, 0n, "escrow holds nothing once every campaign is settled");
      return `treasury ${fmt(feesExpected)} USDC`;
    });
    await step("backend indexer in sync with chain: a full re-sync applies nothing new, no campaign stuck", async () => {
      const s = await sync();
      eq(s.applied, 0, "applied");
      const all = await okApi("GET", "/campaigns?status=FUNDED", { token: sessions.admin.token });
      eq(all.campaigns.length, 0, "no campaign left FUNDED");
    });
  });
}

let failed = false;
try {
  await main();
} catch (e) {
  failed = true;
  console.error("\nE2E harness error:", e?.stack ?? e);
  results.push({ scenario: currentScenario, step: "(harness)", status: "FAIL", detail: String(e?.message ?? e).slice(0, 300) });
} finally {
  await cleanup();
}

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
const md = ["| Scenario | Step | Result |", "|---|---|---|", ...results.map((r) => `| ${r.scenario} | ${r.step.replace(/\|/g, "/")} | ${r.status}${r.status === "FAIL" ? ` - ${r.detail.replace(/\|/g, "/")}` : ""} |`)].join("\n");
writeFileSync(path.join(logDir, "results.md"), md);
console.log(`results table: ${path.join(logDir, "results.md")}`);
process.exit(failed || fail ? 1 : 0);
