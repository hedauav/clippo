#!/usr/bin/env node
// Post-deploy smoke test: node scripts/smoke-deploy.mjs https://your-app.vercel.app [--bypass <protection-bypass-secret>]
// Checks health, chain config, nonce, /wire, security headers, and that cron/admin endpoints reject callers without the secret.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/smoke-deploy.mjs <https://deployment-url> [--bypass <secret>]");
  process.exit(2);
}
const bi = args.indexOf("--bypass");
const extra = bi >= 0 ? { "x-vercel-protection-bypass": args[bi + 1] } : {};
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fail++;
};
const get = (path, init = {}) => fetch(base + path, { redirect: "manual", ...init, headers: { ...extra, ...(init.headers ?? {}) } });

try {
  const h = await get("/api/health");
  const hj = await h.json().catch(() => ({}));
  check("GET /api/health 200 + db ok", h.status === 200 && hj.db === true, `status=${h.status} db=${hj.db}`);
  check("health: chain reachable", hj.chain === true, `chain=${hj.chain}`);
  check("health: required config ready", hj.ready === true, JSON.stringify(hj.config ?? {}));
  check(
    "health: no dangerous keys / doubles off / dev bypass off",
    hj.config?.dangerousKeysAbsent === true && hj.config?.e2eDoublesOff === true && hj.config?.devAuthBypassDisabled === true,
  );
  check("health leaks no secrets", !/0x[0-9a-fA-F]{64}|postgres(ql)?:\/\//.test(JSON.stringify(hj)));

  const c = await get("/api/chain/config");
  const cj = await c.json().catch(() => ({}));
  check("GET /api/chain/config", c.status === 200 && !!cj.chain, `escrow=${cj.chain?.escrow ?? "none"}`);

  const n = await get("/api/auth/nonce");
  const nj = await n.json().catch(() => ({}));
  check("GET /api/auth/nonce", n.status === 200 && typeof nj.nonce === "string", `domain=${nj.domain}`);
  check("nonce domain matches deployment host", nj.domain === new URL(base).host, `${nj.domain} vs ${new URL(base).host}`);

  const w = await get("/wire");
  const wt = await w.text();
  check("GET /wire 200", w.status === 200, `status=${w.status}`);
  const hd = w.headers;
  check("header X-Frame-Options", /deny|sameorigin/i.test(hd.get("x-frame-options") ?? ""));
  check("header Referrer-Policy", !!hd.get("referrer-policy"));
  check("header X-Content-Type-Options", /nosniff/i.test(hd.get("x-content-type-options") ?? ""));
  check("header CSP (report-only)", !!(hd.get("content-security-policy") || hd.get("content-security-policy-report-only")));
  if (hj.config?.testDeploy) {
    check("test deploy: X-Robots-Tag noindex", /noindex/i.test(hd.get("x-robots-tag") ?? ""));
    check("test deploy: TESTNET banner rendered", /TESTNET/.test(wt));
    const rb = await (await get("/robots.txt")).text();
    check("test deploy: robots.txt disallows all", /Disallow:\s*\//.test(rb));
  }

  for (const p of ["/api/cron/chain-sync", "/api/cron/snapshots-refresh", "/api/cron/snapshots-freeze", "/api/cron/video-jobs", "/api/cron/status-ladder"]) {
    const r = await get(p);
    check(`${p} rejects without secret`, r.status === 401, `status=${r.status}`);
    const r2 = await get(p, { headers: { authorization: "Bearer wrong-secret" } });
    check(`${p} rejects wrong secret`, r2.status === 401, `status=${r2.status}`);
  }
  const s = await get("/api/snapshots/refresh", { method: "POST" });
  check("POST /api/snapshots/refresh rejects anonymous", s.status === 401, `status=${s.status}`);
  const dev = await get("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: "0x000000000000000000000000000000000000dEaD", role: "CREATOR" }),
  });
  check("dev wallet-only sign-in refused", dev.status === 401, `status=${dev.status}`);
  const xw = await get("/api/auth/me", { headers: { "x-wallet": "0x000000000000000000000000000000000000dEaD" } });
  const xwj = await xw.json().catch(() => ({}));
  check("x-wallet header ignored", !xwj.user, `status=${xw.status}`);
} catch (e) {
  console.error("smoke test crashed:", e instanceof Error ? e.message : e);
  fail++;
}
console.log(fail ? `\n${fail} check(s) FAILED` : "\nAll checks passed");
process.exit(fail ? 1 : 0);
