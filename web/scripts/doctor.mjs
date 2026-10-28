// `npm run doctor` — checks every env var Clippo needs and pings each real service. Exit code 1 if a REQUIRED item fails.
// Reads .env.local then .env (via node --env-file-if-exists, see package.json). Never prints secret values.
import { access, constants, mkdir } from "node:fs/promises";
import path from "node:path";

const results = [];
const env = (k) => process.env[k]?.trim() || "";
const add = (group, name, status, detail = "", required = true) => results.push({ group, name, status, detail, required });
const has = (group, name, required = true, hint = "") => {
  const ok = !!env(name);
  add(group, name, ok ? "ok" : required ? "MISSING" : "unset", ok ? "set" : hint, required);
  return ok;
};
const timeout = (ms = 10000) => AbortSignal.timeout(ms);
async function ping(group, name, fn, required = true) {
  try {
    const d = await fn();
    add(group, name, "ok", d ?? "reachable", required);
  } catch (e) {
    add(group, name, "FAIL", e instanceof Error ? e.message : String(e), required);
  }
}
const rpc = async (method, params = []) => {
  const r = await fetch(env("ARC_RPC_URL") || "https://rpc.testnet.arc.network", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: timeout() });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

// ---- core
has("core", "DATABASE_URL", true, "Neon/Postgres connection string");
if (env("DATABASE_URL") && !/^postgres(ql)?:\/\//.test(env("DATABASE_URL"))) add("core", "DATABASE_URL shape", "FAIL", "must start with postgresql://");
has("core", "SESSION_SECRET", true, "long random string");
has("core", "ADMIN_WALLETS", true, "comma-separated admin wallet addresses");
has("core", "CRON_SECRET", false, "needed for cron/CRE calling POST /api/snapshots/refresh");
if (env("DATABASE_URL")) {
  await ping("core", "database ping", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    try {
      await db.$queryRaw`SELECT 1`;
      const t = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'Campaign'`);
      if (!t[0]?.n) throw new Error("connected, but migrations are not applied (run: npx prisma migrate deploy)");
      return "connected, schema present";
    } finally {
      await db.$disconnect();
    }
  });
}
await ping("core", "STORAGE_DIR writable", async () => {
  const dir = env("STORAGE_DIR") || path.join(process.cwd(), "storage");
  await mkdir(dir, { recursive: true });
  await access(dir, constants.W_OK);
  return `${dir} (note: use a persistent disk or object store in production; serverless filesystems are ephemeral)`;
}, false);

// ---- chain
has("chain", "ARC_RPC_URL", false, "default https://rpc.testnet.arc.network");
has("chain", "ESCROW_ADDRESS", true, "deploy contracts first (contracts/README.md)");
has("chain", "ESCROW_DEPLOY_BLOCK", false, "block of the escrow deployment (faster indexing)");
await ping("chain", "RPC eth_chainId", async () => {
  const id = parseInt(await rpc("eth_chainId"), 16);
  const want = Number(env("ARC_CHAIN_ID") || 5042002);
  if (id !== want) throw new Error(`chain id ${id} != ARC_CHAIN_ID ${want}`);
  return `chain ${id}`;
});
for (const [k, req] of [["ESCROW_ADDRESS", true], ["PROFILE_ADDRESS", false], ["REFERRAL_ADDRESS", false]]) {
  if (k !== "ESCROW_ADDRESS") has("chain", k, false, "needed for FEATURE_TOKENIZATION / FEATURE_REFERRAL");
  if (env(k)) await ping("chain", `${k} has code`, async () => ((await rpc("eth_getCode", [env(k), "latest"])) === "0x" ? Promise.reject(new Error("no contract at address")) : "contract found"), req);
}
if (has("chain", "UPDATER_PRIVATE_KEY", false, "signer for profile sync / referrer freeze (registered via setUpdater)")) {
  await ping("chain", "UPDATER_PRIVATE_KEY balance", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const k = env("UPDATER_PRIVATE_KEY");
    const a = privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`);
    const bal = BigInt(await rpc("eth_getBalance", [a.address, "latest"]));
    return `${a.address} balance ${bal} wei (Arc gas is USDC; fund via the Circle faucet)${bal === 0n ? " - EMPTY" : ""}`;
  }, false);
}
add("chain", "CIRCLE_FAUCET_URL", "ok", env("CIRCLE_FAUCET_URL") || "default https://faucet.circle.com (testnet USDC)", false);

// ---- World ID
const widOk = [has("world", "WORLD_ID_APP_ID"), has("world", "WORLD_ID_RP_ID"), has("world", "WORLD_ID_SIGNING_KEY")].every(Boolean);
has("world", "WORLD_ID_ACTION", false, "default clippo-creator-signup");
has("world", "WORLD_ID_ENVIRONMENT", false, "default production (use staging with the simulator)");
if (widOk) {
  await ping("world", "RP signing key", async () => {
    const { signRequest } = await import("@worldcoin/idkit-core/signing");
    const raw = String(env("WORLD_ID_SIGNING_KEY") ?? "").trim().replace(/^WORLD_ID_SIGNING_KEYs*=s*/, "").replace(/^(['"`])(.*)$/s, "$2").trim();
    const hex = raw.replace(/^0x/i, "");
    if (/BEGIN/.test(raw)) throw new Error("looks like PEM; expected 64 hex characters");
    if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error("contains non-hex characters (length " + raw.length + ")");
    if (hex.length !== 64) throw new Error("expected 64 hex characters, got " + hex.length);
    signRequest({ signingKeyHex: "0x" + hex.toLowerCase(), action: "doctor" });
    return "can sign an RP request";
  });
  await ping("world", "Developer Portal rp_id", async () => {
    const r = await fetch(`https://developer.world.org/api/v4/verify/${encodeURIComponent(env("WORLD_ID_RP_ID"))}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: timeout() });
    if (r.status === 404) throw new Error("rp_id not found (404)");
    return `portal answered ${r.status} (4xx is expected for an empty proof)`;
  });
}

// ---- AI / platforms
// Same selection rule as src/lib/ai/llm.ts: LLM_PROVIDER wins; else the only key set; both keys -> anthropic.
const llmForced = env("LLM_PROVIDER").toLowerCase();
const llmProvider = llmForced || (env("ANTHROPIC_API_KEY") ? "anthropic" : env("GEMINI_API_KEY") ? "gemini" : "");
if (!llmProvider) add("ai", "LLM provider", "MISSING", "set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey) or ANTHROPIC_API_KEY");
else if (llmProvider !== "anthropic" && llmProvider !== "gemini") add("ai", "LLM_PROVIDER", "FAIL", `must be anthropic or gemini (got ${llmProvider})`);
else {
  add("ai", "LLM provider", "ok", llmProvider + (llmForced ? " (LLM_PROVIDER)" : " (auto)"));
  if (llmProvider === "anthropic" && has("ai", "ANTHROPIC_API_KEY")) {
    await ping("ai", "Anthropic API", async () => {
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" }, signal: timeout() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return `ok (model ${env("ANTHROPIC_MODEL") || "claude-sonnet-5-5"})`;
    });
  }
  if (llmProvider === "gemini" && has("ai", "GEMINI_API_KEY")) {
    // Minimal ping: one tiny generation (counts as 1 request against the free-tier quota).
    await ping("ai", "Gemini text API", async () => {
      const model = env("GEMINI_TEXT_MODEL") || "gemini-3.5-flash-lite";
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env("GEMINI_API_KEY") },
        body: JSON.stringify({ model, input: "Reply with the single word: ok", generation_config: { max_output_tokens: 32 } }),
        signal: timeout(20000),
      });
      if (r.status === 429) return `key valid but quota exhausted right now (free-tier limits; retry later), model ${model}`;
      if (!r.ok) throw new Error(`model ${model}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
      return `ok (model ${model}; free tier works without billing)`;
    });
  }
}
if (has("platforms", "YOUTUBE_API_KEY")) {
  await ping("platforms", "YouTube Data API v3", async () => {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${env("YOUTUBE_API_KEY")}`, { signal: timeout() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return "ok";
  });
}
if (has("platforms", "X_BEARER_TOKEN")) {
  await ping("platforms", "X API v2", async () => {
    const r = await fetch("https://api.x.com/2/users/by/username/x", { headers: { authorization: `Bearer ${env("X_BEARER_TOKEN")}` }, signal: timeout() });
    if (!r.ok) throw new Error(`HTTP ${r.status} (check your X API tier allows reads)`);
    return "ok";
  });
}
const ig = [has("platforms", "INSTAGRAM_APP_ID"), has("platforms", "INSTAGRAM_APP_SECRET"), has("platforms", "INSTAGRAM_REDIRECT_URI")];
if (ig.every(Boolean)) add("platforms", "Instagram OAuth", "ok", "configured (authorisation itself can only be tested by a creator connecting an account)");
has("platforms", "INSTAGRAM_POST_CONNECT_URL", false, "where to send creators after OAuth (default /)");

// ---- video
const provider = env("VIDEO_GEN_PROVIDER") || "gemini";
if (provider === "gemini") {
  if (has("video", "GEMINI_API_KEY")) {
    await ping("video", "Gemini API", async () => {
      const model = env("GEMINI_VIDEO_MODEL") || "gemini-omni-1.1-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, { headers: { "x-goog-api-key": env("GEMINI_API_KEY") }, signal: timeout() });
      if (!r.ok) throw new Error(`model ${model}: HTTP ${r.status}`);
      return `model ${model} available (Gemini Omni video is paid-tier only: enable billing on this key's project before generating)`;
    });
  }
} else if (provider === "http") has("video", "VIDEO_GEN_URL");

// ---- on-ramp
const tk = [has("onramp", "TRANSAK_API_KEY"), has("onramp", "TRANSAK_API_SECRET")];
has("onramp", "TRANSAK_REFERRER_DOMAIN", false, "your site domain registered with Transak");
has("onramp", "TRANSAK_NETWORK", false, "Transak network slug for Arc, if supported");
if (tk.every(Boolean)) {
  await ping("onramp", "Transak partner auth", async () => {
    const host = env("TRANSAK_ENV") === "production" ? "https://api.transak.com" : "https://api-stg.transak.com";
    const r = await fetch(`${host}/partners/api/v2/refresh-token`, { method: "POST", headers: { "content-type": "application/json", "api-secret": env("TRANSAK_API_SECRET") }, body: JSON.stringify({ apiKey: env("TRANSAK_API_KEY") }), signal: timeout() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return `${env("TRANSAK_ENV") === "production" ? "production" : "staging"} ok`;
  });
}

// ---- report
const icon = { ok: "OK     ", MISSING: "MISSING", FAIL: "FAIL   ", unset: "unset  " };
let group = "";
for (const r of results) {
  if (r.group !== group) console.log(`\n[${(group = r.group)}]`);
  console.log(`  ${icon[r.status]} ${r.name}${r.detail ? ` - ${r.detail}` : ""}${r.required || r.status === "ok" ? "" : " (optional)"}`);
}
const bad = results.filter((r) => r.required && (r.status === "MISSING" || r.status === "FAIL"));
console.log(`\n${bad.length ? `${bad.length} required item(s) need attention: ${bad.map((b) => b.name).join(", ")}` : "All required checks passed."}`);
process.exit(bad.length ? 1 : 0);
