// HTTP API end-to-end against a running dev server. Usage: node scripts/e2e-api.mjs [--base http://localhost:3217]
// Needs `npm run dev` plus its database (`npm run db:local`, single connection: run no other DB client meanwhile).
// Signs in with SIWE using random test keys (real signatures). No credentials are configured in dev, so every step that
// would need World ID / the escrow / a platform API / an LLM asserts the honest NOT_CONFIGURED (or NOT_VERIFIED) answer
// instead of a fake success; the credentialed happy paths are covered by vitest with the explicit test doubles.
// The admin uses the dev-only wallet bypass (ADMIN_WALLETS wallet, NODE_ENV != production).
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { readFileSync, existsSync } from "node:fs";

const i = process.argv.indexOf("--base");
const BASE = (i > -1 ? process.argv[i + 1] : process.env.BASE_URL ?? "http://localhost:3217").replace(/\/$/, "");
const envFile = new URL("../.env", import.meta.url);
const adminWallet = (process.env.ADMIN_WALLET ?? (existsSync(envFile) ? /ADMIN_WALLETS="?([^",\n]+)/.exec(readFileSync(envFile, "utf8"))?.[1] : "") ?? "").trim();

let pass = 0;
let fail = 0;
const results = [];
async function step(name, fn) {
  try {
    await fn();
    pass++;
    results.push(["PASS", name]);
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    results.push(["FAIL", name, e.message]);
    console.log(`FAIL  ${name}  -> ${e.message}`);
  }
}
const eq = (a, b, what = "value") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const truthy = (v, what) => {
  if (!v) throw new Error(`${what} is falsy`);
};

async function call(method, path, { token, body, headers, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}
const expectStatus = (r, status, code) => {
  if (r.status !== status) throw new Error(`HTTP ${r.status} ${r.text?.slice(0, 200)} (wanted ${status}${code ? " " + code : ""})`);
  if (code && r.json?.error?.code !== code) throw new Error(`error.code ${r.json?.error?.code} (wanted ${code})`);
};

/** Real SIWE sign-in with a random key. */
async function siwe(role, key = generatePrivateKey()) {
  const account = privateKeyToAccount(key);
  const n = await call("GET", "/api/auth/nonce");
  expectStatus(n, 200);
  const { nonce, domain, uri, chainId, statement } = n.json;
  const message = createSiweMessage({ address: account.address, chainId, domain, nonce, uri, version: "1", statement, issuedAt: new Date(), expirationTime: new Date(Date.now() + 5 * 60_000) });
  const signature = await account.signMessage({ message });
  const s = await call("POST", "/api/auth/session", { body: { message, signature, role } });
  return { account, message, signature, session: s, token: s.json?.token, user: s.json?.user };
}

const story = { summary: "Promote Ledgerlane", topic: "Ledgerlane accounting close", requiredPoints: ["closes the books faster"], prohibitedClaims: ["risk-free"], disclosureLabel: "#ad", attribution: "Credit the original creator" };
const campaignBody = (extra = {}) => ({ title: "E2E campaign", story, contentSource: "LINK", contentUrl: "https://example.com/v.mp4", platforms: ["YOUTUBE", "X"], payoutMode: "PER_VIEW", ratePer1k: 2, poolSize: 500, viewTarget: 250000, eligibility: "ANYONE_VERIFIED", ...extra });

console.log(`base ${BASE}`);
const camp = {};
const cre = {};
let admin = null;

// ---- 1. SIWE sign-in -----------------------------------------------------------------------------------------------
await step("SIWE: campaigner signs in with a random key (new account, role CAMPAIGNER)", async () => {
  Object.assign(camp, await siwe("CAMPAIGNER"));
  expectStatus(camp.session, 200);
  eq(camp.user.role, "CAMPAIGNER");
  eq(camp.user.verified, false);
  eq(camp.user.wallet, camp.account.address.toLowerCase());
});
await step("SIWE: creator signs in (role CREATOR); /api/auth/me returns the account", async () => {
  Object.assign(cre, await siwe("CREATOR"));
  expectStatus(cre.session, 200);
  const me = await call("GET", "/api/auth/me", { token: cre.token });
  eq(me.json.user.role, "CREATOR");
});
await step("SIWE: replayed message is refused (nonce is single-use) and a forged signature is refused", async () => {
  const replay = await call("POST", "/api/auth/session", { body: { message: camp.message, signature: camp.signature, role: "CAMPAIGNER" } });
  expectStatus(replay, 401, "NONCE_INVALID");
  const other = privateKeyToAccount(generatePrivateKey());
  const forged = await call("POST", "/api/auth/session", { body: { message: camp.message, signature: await other.signMessage({ message: camp.message }) } });
  expectStatus(forged, 401);
});
await step("auth: unauthenticated requests are 401; wrong role is 403", async () => {
  expectStatus(await call("GET", "/api/dashboard/campaigner"), 401, "UNAUTHENTICATED");
  expectStatus(await call("GET", "/api/dashboard/campaigner", { token: cre.token }), 403, "FORBIDDEN");
});
await step("auth: admin (ADMIN_WALLETS) signs in through the dev-only bypass", async () => {
  truthy(adminWallet, "ADMIN_WALLETS wallet");
  const s = await call("POST", "/api/auth/session", { body: { wallet: adminWallet } });
  expectStatus(s, 200);
  eq(s.json.user.role, "ADMIN");
  admin = { token: s.json.token };
});

// ---- 2. Wizard + campaign ------------------------------------------------------------------------------------------
await step("wizard: suggest turns an idea into a story and pool/rate/view-target options", async () => {
  const r = await call("POST", "/api/wizard/suggest", { token: camp.token, body: { idea: "Ledgerlane, an accounting close tool for small finance teams", contentSource: "LINK", platforms: ["YOUTUBE", "X"], payoutMode: "PER_VIEW", eligibility: "ANYONE_VERIFIED" } });
  if (r.status === 503) {
    // no LLM credentials configured: the honest answer, never an invented story
    eq(r.json.error.code, "NOT_CONFIGURED");
    return;
  }
  expectStatus(r, 200);
  truthy(r.json.story.requiredPoints.length, "story.requiredPoints");
  truthy(r.json.story.disclosureLabel, "story.disclosureLabel");
  truthy(r.json.suggestions.length >= 3, "suggestions");
});
await step("wizard: only campaigners/admins may call it; a bad body is 400", async () => {
  expectStatus(await call("POST", "/api/wizard/suggest", { token: cre.token, body: { idea: "x y z" } }), 403);
  expectStatus(await call("POST", "/api/wizard/suggest", { token: camp.token, body: { idea: "" } }), 400, "BAD_REQUEST");
});
let c1;
await step("campaign: create (DRAFT) for each payout mode; incomplete combos are 400", async () => {
  const r = await call("POST", "/api/campaigns", { token: camp.token, body: campaignBody() });
  expectStatus(r, 201);
  eq(r.json.campaign.status, "DRAFT");
  c1 = r.json.campaign;
  const split = await call("POST", "/api/campaigns", { token: camp.token, body: campaignBody({ payoutMode: "HUMAN_SPLIT", ratePer1k: undefined, approver: "CAMPAIGNER_AND_ADMIN" }) });
  expectStatus(split, 201);
  eq(split.json.campaign.approver, "CAMPAIGNER_AND_ADMIN");
  const pool = await call("POST", "/api/campaigns", { token: camp.token, body: campaignBody({ payoutMode: "POOL_SHARE", ratePer1k: undefined, poolShareBasis: "APPROVED_CLIPS", eligibility: "HIGHER_RANKED" }) });
  expectStatus(pool, 201);
  eq(pool.json.campaign.poolShareBasis, "APPROVED_CLIPS");
  expectStatus(await call("POST", "/api/campaigns", { token: camp.token, body: campaignBody({ payoutMode: "POOL_SHARE", ratePer1k: undefined }) }), 400, "BAD_REQUEST");
  expectStatus(await call("POST", "/api/campaigns", { token: cre.token, body: campaignBody() }), 403);
  c1.pool = pool.json.campaign;
});
await step("campaign: a DRAFT is hidden from the marketplace and from non-owners, visible to its owner", async () => {
  const pub = await call("GET", "/api/campaigns");
  expectStatus(pub, 200);
  eq(pub.json.campaigns.some((c) => c.id === c1.id), false, "draft in public list");
  expectStatus(await call("GET", `/api/campaigns/${c1.id}`, { token: cre.token }), 404, "NOT_FOUND");
  const mine = await call("GET", "/api/campaigns?mine=true", { token: camp.token });
  eq(mine.json.campaigns.some((c) => c.id === c1.id), true, "draft in my list");
  expectStatus(await call("GET", `/api/campaigns/${c1.id}`, { token: camp.token }), 200);
});

// ---- 3. Funding + admin approval ------------------------------------------------------------------------------------
await step("fund preview: fee per side, net pool, create-campaign arguments (mode 0 = per view)", async () => {
  const r = await call("GET", `/api/campaigns/${c1.id}/fund`, { token: camp.token });
  expectStatus(r, 200);
  const bps = r.json.preview.campaignerFeeBps;
  truthy(bps >= 10 && bps <= 50, `campaigner fee ${bps} bps within 0.1-0.5%`);
  truthy(r.json.preview.netPool < r.json.preview.poolAmount, "netPool < pool");
  eq(r.json.createCampaignArgs.mode, 0);
  truthy(r.json.fees.creatorBps >= 10 && r.json.fees.creatorBps <= 50, "creator fee within 0.1-0.5%");
  expectStatus(await call("GET", `/api/campaigns/${c1.id}/fund`, { token: cre.token }), 403);
});
await step("fund: recording a funding tx without a configured escrow is NOT_CONFIGURED (campaign stays DRAFT)", async () => {
  const r = await call("POST", `/api/campaigns/${c1.id}/fund`, { token: camp.token, body: { txHash: "0x" + "ab".repeat(32) } });
  expectStatus(r, 503, "NOT_CONFIGURED");
  const g = await call("GET", `/api/campaigns/${c1.id}`, { token: camp.token });
  eq(g.json.campaign.status, "DRAFT");
});
await step("admin: approve without a configured escrow is NOT_CONFIGURED; creators/campaigners cannot approve", async () => {
  expectStatus(await call("POST", `/api/campaigns/${c1.id}/approve`, { token: admin.token, body: {} }), 503, "NOT_CONFIGURED");
  expectStatus(await call("POST", `/api/campaigns/${c1.id}/approve`, { token: camp.token, body: {} }), 403);
  expectStatus(await call("POST", `/api/campaigns/${c1.id}/approve`, { token: cre.token, body: {} }), 403);
});
await step("admin: rejecting a never-funded draft needs a reason, records it, and refunds nothing", async () => {
  expectStatus(await call("POST", `/api/campaigns/${c1.pool.id}/reject`, { token: admin.token, body: {} }), 400, "BAD_REQUEST");
  const r = await call("POST", `/api/campaigns/${c1.pool.id}/reject`, { token: admin.token, body: { reason: "e2e: off brief" } });
  expectStatus(r, 200);
  eq(r.json.campaign.status, "REJECTED");
  eq(r.json.refund, null);
});
await step("admin: oversight queue (campaigns, flagged clips, appeals, fraud flags, split proposals); others are 403", async () => {
  const q = await call("GET", "/api/admin/queue", { token: admin.token });
  expectStatus(q, 200);
  for (const k of ["pendingCampaigns", "flaggedSubmissions", "appeals", "fraudFlags", "splitProposals"]) truthy(Array.isArray(q.json[k]), k);
  expectStatus(await call("GET", "/api/admin/queue", { token: camp.token }), 403);
  expectStatus(await call("GET", "/api/admin/queue"), 401);
});
await step("pool share: weights endpoint is owner/admin only and only for an APPROVED POOL_SHARE campaign", async () => {
  expectStatus(await call("GET", `/api/campaigns/${c1.id}/pool-share`, { token: camp.token }), 409, "BAD_STATE");
  expectStatus(await call("GET", `/api/campaigns/${c1.id}/pool-share`, { token: cre.token }), 403);
});

// ---- 4. Creator: human check, channel ownership proof, submissions, appeal --------------------------------------------
await step("unique human: World ID endpoints are NOT_CONFIGURED without credentials (no mock verifier)", async () => {
  expectStatus(await call("POST", "/api/worldid/verify", { token: cre.token, body: { nullifier_hash: "0x1", proof: "p" } }), 503, "NOT_CONFIGURED");
  expectStatus(await call("POST", "/api/worldid/rp-signature", { token: cre.token, body: {} }), 503, "NOT_CONFIGURED");
});
await step("channel proof: an unverified human cannot start it (NOT_VERIFIED); the channel list is empty", async () => {
  expectStatus(await call("POST", "/api/channels", { token: cre.token, body: { platform: "YOUTUBE", handle: "@e2e-creator" } }), 403, "NOT_VERIFIED");
  const l = await call("GET", "/api/channels", { token: cre.token });
  expectStatus(l, 200);
  eq(l.json.channels, []);
});
await step("submission: unverified creator is refused; a link to a non-open campaign never reaches the verifier", async () => {
  expectStatus(await call("POST", "/api/submissions", { token: cre.token, body: { campaignId: c1.id, channelId: "nope", link: "https://youtu.be/dQw4w9WgXcQ" } }), 403, "NOT_VERIFIED");
  const mine = await call("GET", "/api/submissions", { token: cre.token });
  expectStatus(mine, 200);
  eq(mine.json.submissions, []);
  expectStatus(await call("POST", "/api/submissions", { token: camp.token, body: { campaignId: c1.id, channelId: "n", link: "https://youtu.be/dQw4w9WgXcQ" } }), 403, "FORBIDDEN");
});
await step("appeal + verdict: unknown submission is 404; campaigners cannot appeal; creators cannot set verdicts", async () => {
  expectStatus(await call("POST", "/api/submissions/nope/appeal", { token: cre.token, body: { note: "please" } }), 404);
  expectStatus(await call("POST", "/api/submissions/nope/appeal", { token: camp.token, body: { note: "please" } }), 403);
  expectStatus(await call("POST", "/api/submissions/nope/verdict", { token: cre.token, body: { result: "APPROVE", reason: "x" } }), 403);
  expectStatus(await call("POST", "/api/submissions/nope/verdict", { token: camp.token, body: { result: "APPROVE", reason: "x" } }), 404);
  expectStatus(await call("GET", "/api/appeals", { token: cre.token }), 200);
});
await step("claim: unknown payout is 404 (claims need a verified creator and an on-chain claim receipt)", async () => {
  expectStatus(await call("POST", "/api/payouts/nope/claim", { token: cre.token, body: {} }), 404);
});

// ---- 5. Source content + AI video --------------------------------------------------------------------------------------
await step("source content: upload an mp4, attach it, play it with Range (206) and download it (attachment)", async () => {
  const mp4 = Buffer.alloc(256);
  Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(mp4);
  const fd = new FormData();
  fd.append("file", new File([mp4], "source clip.mp4", { type: "video/mp4" }));
  const up = await fetch(`${BASE}/api/uploads`, { method: "POST", headers: { authorization: `Bearer ${camp.token}` }, body: fd });
  eq(up.status, 201);
  const upload = (await up.json()).upload;
  const attach = await call("POST", `/api/campaigns/${c1.id}/source`, { token: camp.token, body: { uploadId: upload.id } });
  expectStatus(attach, 200);
  eq(attach.json.campaign.contentSource, "UPLOAD");
  const range = await fetch(`${BASE}/api/uploads/${upload.id}/file`, { headers: { authorization: `Bearer ${camp.token}`, range: "bytes=0-15" } });
  eq(range.status, 206);
  eq(range.headers.get("content-range"), "bytes 0-15/256");
  const dl = await fetch(`${BASE}/api/uploads/${upload.id}/file?download=1`, { headers: { authorization: `Bearer ${camp.token}` } });
  eq(dl.status, 200);
  truthy(/attachment/.test(dl.headers.get("content-disposition") ?? ""), "content-disposition attachment");
  const spoof = new FormData();
  spoof.append("file", new File([Buffer.alloc(32)], "evil.mp4", { type: "video/mp4" }));
  eq((await fetch(`${BASE}/api/uploads`, { method: "POST", headers: { authorization: `Bearer ${camp.token}` }, body: spoof })).status, 415);
  // a stranger cannot read a source whose campaign is not open yet
  eq((await fetch(`${BASE}/api/uploads/${upload.id}/file`, { headers: { authorization: `Bearer ${cre.token}` } })).status, 404);
});
await step("source content: link-a-video accepts http(s) only", async () => {
  expectStatus(await call("POST", `/api/campaigns/${c1.id}/source`, { token: camp.token, body: { url: "javascript:alert(1)" } }), 400, "BAD_LINK");
  expectStatus(await call("POST", `/api/campaigns/${c1.id}/source`, { token: camp.token, body: { url: "https://example.com/v.mp4" } }), 200);
});
await step("AI video: generation is NOT_CONFIGURED without a provider key; rights confirmation is required first", async () => {
  expectStatus(await call("POST", "/api/ai-video/jobs", { token: camp.token, body: { prompt: "a clean product demo of an accounting tool", rightsConfirmed: false } }), 400);
  expectStatus(await call("POST", "/api/ai-video/jobs", { token: camp.token, body: { prompt: "a clean product demo of an accounting tool", rightsConfirmed: true } }), 503, "NOT_CONFIGURED");
});

// ---- 6. Workspace / hire ------------------------------------------------------------------------------------------------
let shortlist;
let hire;
await step("workspace: creator profile + rate card (creator-set rates); the directory lists only vetted (verified) creators", async () => {
  const p = await call("PUT", "/api/creators/profile", { token: cre.token, body: { displayName: "E2E Creator", bio: "tech clips", niches: ["fintech"], rateCard: [{ label: "Short clip", platform: "YOUTUBE", price: 75 }], listed: true } });
  expectStatus(p, 200);
  const dir = await call("GET", "/api/creators");
  expectStatus(dir, 200);
  eq(dir.json.creators.some((c) => c.id === cre.user.id || c.userId === cre.user.id), false, "unverified creator hidden from the directory");
});
await step("workspace: shortlist (shareable token), structured brief, hire with a live budget total", async () => {
  shortlist = await call("POST", "/api/shortlists", { token: camp.token, body: { title: "E2E shortlist" } });
  expectStatus(shortlist, 201);
  const token = shortlist.json.shareToken ?? shortlist.json.shortlist?.shareToken;
  truthy(token, "shortlist share token");
  expectStatus(await call("GET", `/api/shortlists/shared/${token}`), 200);
  const brief = await call("POST", "/api/briefs", { token: camp.token, body: { title: "E2E brief", story, deliverables: ["1 short clip"], platforms: ["YOUTUBE"], notes: "" } });
  expectStatus(brief, 201);
  hire = await call("POST", "/api/hires", { token: camp.token, body: { title: "E2E hire", briefId: brief.json.brief?.id ?? brief.json.id } });
  expectStatus(hire, 201);
  const id = hire.json.hire?.id ?? hire.json.id;
  truthy(id, "hire id");
  const view = await call("GET", `/api/hires/${id}`, { token: camp.token });
  expectStatus(view, 200);
  hire.id = id;
  // fund-all needs an approved creator on the hire: refused, nothing is funded
  const fund = await call("POST", `/api/hires/${id}/fund`, { token: camp.token, body: {} });
  truthy(fund.status >= 400 && fund.status < 600, `fund-all refused (got ${fund.status})`);
});

// ---- 7. Dashboards, marketplace, snapshots ------------------------------------------------------------------------------
await step("dashboards: campaigner, creator, earnings; leaderboard and trending are public", async () => {
  expectStatus(await call("GET", "/api/dashboard/campaigner", { token: camp.token }), 200);
  expectStatus(await call("GET", "/api/dashboard/creator", { token: cre.token }), 200);
  expectStatus(await call("GET", "/api/creator/earnings", { token: cre.token }), 200);
  const lb = await call("GET", "/api/leaderboard?sort=earnings");
  expectStatus(lb, 200);
  truthy(Array.isArray(lb.json.creators), "leaderboard creators");
  const tr = await call("GET", "/api/marketplace/trending");
  expectStatus(tr, 200);
  truthy(Array.isArray(tr.json.campaigns), "trending campaigns");
});
await step("snapshots/latest: JSON array whose campaign ids are numeric on-chain ids; daily feed is frozen per completed day", async () => {
  const r = await call("GET", "/api/snapshots/latest");
  expectStatus(r, 200);
  truthy(Array.isArray(r.json), "array");
  truthy(r.json.every((row) => /^\d+$/.test(row.campaignId) && typeof row.creator === "string" && Number.isInteger(row.cumulativeViews)), "numeric campaignId rows");
  const d = await call("GET", "/api/snapshots/daily");
  expectStatus(d, 200);
  truthy(/^\d{4}-\d{2}-\d{2}$/.test(d.json.day) && typeof d.json.hash === "string" && Array.isArray(d.json.rows), "frozen envelope");
  const today = new Date().toISOString().slice(0, 10);
  expectStatus(await call("GET", `/api/snapshots/daily?day=${today}`), 400, "BAD_REQUEST");
});
await step("chain: config is public and reports not enabled; sync is NOT_CONFIGURED", async () => {
  const c = await call("GET", "/api/chain/config");
  expectStatus(c, 200);
  eq(c.json.chain.enabled, false);
  const s = await call("POST", "/api/chain/sync", { token: admin.token, body: {} });
  expectStatus(s, 503, "CHAIN_NOT_CONFIGURED");
});
await step("on-ramp: session is NOT_CONFIGURED without Transak credentials", async () => {
  const r = await call("POST", "/api/onramp/session", { token: camp.token, body: { campaignId: c1.id, amount: 100 } });
  truthy([503, 400].includes(r.status), `status ${r.status}`);
  if (r.status === 503) eq(r.json.error.code, "NOT_CONFIGURED");
});

// ---- 8. Optional modules + out-of-scope ---------------------------------------------------------------------------------
await step("optional modules (tokenization, referral, status ladder) answer 404 FEATURE_DISABLED while their flags are off", async () => {
  for (const [method, path, token] of [
    ["GET", "/api/status/ladder", cre.token],
    ["GET", "/api/referral/summary", cre.token],
    ["GET", "/api/referral/links", cre.token],
    ["GET", "/api/creator/onchain-profile", cre.token],
    ["POST", "/api/creator/onchain-profile/sync", cre.token],
    ["POST", "/api/status/recompute", admin.token],
  ]) {
    const r = await call(method, path, { token, body: method === "POST" ? {} : undefined });
    if (r.status !== 404 || r.json?.error?.code !== "FEATURE_DISABLED") throw new Error(`${method} ${path} -> ${r.status} ${r.json?.error?.code}`);
  }
});
await step("out of scope: no Radar Room, Jobs, bank cash-out or citation-monitoring endpoints", async () => {
  for (const p of ["/api/radar", "/api/jobs", "/api/cashout", "/api/withdraw", "/api/monitor", "/api/agents/creators"]) eq((await call("GET", p)).status, 404, p);
});
await step("agents: assistant endpoints never move money (creator explain/check need a campaign; admin disputes are admin-only)", async () => {
  expectStatus(await call("GET", "/api/assistant/admin/disputes", { token: camp.token }), 403);
  const r = await call("POST", "/api/assistant/creator/explain", { token: cre.token, body: { campaignId: "nope" } });
  truthy([404, 503].includes(r.status), `explain status ${r.status}`);
  expectStatus(await call("POST", `/api/campaigns/${c1.id}/split/propose`, { token: cre.token, body: {} }), 403);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
