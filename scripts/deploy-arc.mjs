// Post-deploy writer for Arc testnet. Reads the forge broadcast log and writes addresses into
// web/.env.local and cre/workflows/clippo-settlement/config.staging.json (+ cre/project.yaml RPC).
// Usage (from repo root):
//   node scripts/deploy-arc.mjs            # write from contracts/broadcast/Deploy.s.sol/5042002/run-latest.json
//   node scripts/deploy-arc.mjs --dry      # print, write nothing
//   node scripts/deploy-arc.mjs --deploy   # run `forge script ... --broadcast --verify` first (needs env, see docs/tracks/ARC.md)
// Workflow auth (ClippoReportReceiver): --deploy requires EXPECTED_WORKFLOW_OWNER (CRE workflow owner address), optional
// EXPECTED_WORKFLOW_ID (bytes32 hex) and EXPECTED_WORKFLOW_NAME (bytes10 hex). For `cre workflow simulate --broadcast` against
// the mock forwarder (no metadata) set INSECURE_SKIP_WORKFLOW_CHECK=true instead. The values are recorded in the CRE config.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry");
const CHAIN_ID = 5042002;
const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
const EXPLORER = "https://explorer.testnet.arc.io";

if (process.argv.includes("--deploy")) {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) { console.error("Set DEPLOYER_PRIVATE_KEY (testnet key only) plus ADMIN_ADDRESS, FORWARDER_ADDRESS, UPDATER_ADDRESS."); process.exit(1); }
  const skip = process.env.INSECURE_SKIP_WORKFLOW_CHECK === "true";
  const wo = process.env.EXPECTED_WORKFLOW_OWNER;
  if (!skip && !/^0x[0-9a-fA-F]{40}$/.test(wo || "")) { console.error("Set EXPECTED_WORKFLOW_OWNER=0x<CRE workflow owner> (fail-closed receiver), or INSECURE_SKIP_WORKFLOW_CHECK=true for simulation only."); process.exit(1); }
  if (skip) console.warn("WARNING: INSECURE_SKIP_WORKFLOW_CHECK=true -> receiver accepts any workflow behind the forwarder. Simulation only; never production.");
  const args = ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC, "--private-key", key, "--broadcast"];
  if (!process.argv.includes("--no-verify")) args.push("--verify", "--verifier", "blockscout", "--verifier-url", `${EXPLORER}/api/`);
  const r = spawnSync("forge", args, { cwd: path.join(root, "contracts"), stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const logPath = path.join(root, "contracts/broadcast/Deploy.s.sol", String(CHAIN_ID), "run-latest.json");
if (!existsSync(logPath)) { console.error(`No broadcast log at ${logPath}. Deploy first.`); process.exit(1); }
const log = JSON.parse(readFileSync(logPath, "utf8"));
const addr = {};
for (const t of log.transactions) if (t.transactionType === "CREATE" && t.contractName) addr[t.contractName] = t.contractAddress;
const need = ["ClippoEscrow", "ClippoReportReceiver", "ClippoReferral", "ClippoCreatorProfile"];
for (const n of need) if (!addr[n]) { console.error(`Missing ${n} in broadcast log`); process.exit(1); }
const create = log.transactions.find((t) => t.contractName === "ClippoEscrow");
const rcpt = (log.receipts || []).find((r) => r.transactionHash === create.hash);
const block = rcpt ? parseInt(rcpt.blockNumber, 16) : 0;

const env = {
  ARC_RPC_URL: RPC,
  ARC_CHAIN_ID: String(CHAIN_ID),
  ESCROW_ADDRESS: addr.ClippoEscrow,
  ESCROW_DEPLOY_BLOCK: String(block),
  REFERRAL_ADDRESS: addr.ClippoReferral,
  PROFILE_ADDRESS: addr.ClippoCreatorProfile,
  REPORT_RECEIVER_ADDRESS: addr.ClippoReportReceiver,
};
console.log(env);

function upsertEnv(file, vars) {
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    const line = `${k}="${v}"`;
    text = re.test(text) ? text.replace(re, line) : text + (text.endsWith("\n") || !text ? "" : "\n") + line + "\n";
  }
  return text;
}
const envFile = path.join(root, "web/.env.local");
const creCfg = path.join(root, "cre/workflows/clippo-settlement/config.staging.json");
const creProj = path.join(root, "cre/project.yaml");

if (dry) { console.log("--dry: nothing written"); process.exit(0); }
writeFileSync(envFile, upsertEnv(envFile, env));
console.log("updated", envFile);
if (existsSync(creCfg)) {
  const c = JSON.parse(readFileSync(creCfg, "utf8"));
  c.evm = { ...c.evm, receiverAddress: addr.ClippoReportReceiver };
  // informational record of what the receiver was deployed to accept (the workflow ignores unknown keys)
  const wf = { EXPECTED_WORKFLOW_OWNER: "expectedWorkflowOwner", EXPECTED_WORKFLOW_ID: "expectedWorkflowId", EXPECTED_WORKFLOW_NAME: "expectedWorkflowName" };
  for (const [k, field] of Object.entries(wf)) if (process.env[k]) c.evm[field] = process.env[k];
  if (process.env.INSECURE_SKIP_WORKFLOW_CHECK === "true") c.evm.workflowCheckSkipped = true; else delete c.evm.workflowCheckSkipped;
  writeFileSync(creCfg, JSON.stringify(c, null, 2) + "\n");
  console.log("updated", creCfg);
}
if (existsSync(creProj)) {
  const y = readFileSync(creProj, "utf8").replace(/url: "https:\/\/REPLACE-WITH-ARC-TESTNET-RPC"/, `url: "${RPC}"`);
  writeFileSync(creProj, y);
  console.log("updated", creProj);
}
console.log(`Explorer: ${EXPLORER}/address/${addr.ClippoEscrow}`);
console.log("Workflow auth later: cast send $REPORT_RECEIVER_ADDRESS \"setExpectedWorkflowOwner(address)\" 0x<owner> (also setExpectedWorkflowId(bytes32), setExpectedWorkflowName(bytes10), setForwarder(address), setWorkflowCheckSkipped(bool)).");
console.log("Next: (cd web && npm run abi:sync) if the ABI changed; fund campaigns with faucet USDC; set UPDATER_PRIVATE_KEY.");
