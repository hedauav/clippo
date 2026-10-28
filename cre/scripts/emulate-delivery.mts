// NOT the CRE simulator. Fallback evidence for when `cre login` is unavailable: runs the SAME fetch -> normalise ->
// chunk -> ABI-encode code path as the workflow (snapshot.ts) against the mock backend, then delivers each report to
// ClippoReportReceiver through the real Arc-testnet MockKeystoneForwarder (present on the anvil fork), exactly the
// contract call the CRE simulator's --broadcast makes. Prints the escrow credit.
// Run (from cre/): node --experimental-strip-types scripts/emulate-delivery.mts
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertFresh, chunkRows, encodeReport, normalizeSnapshot, parseFrozenFeed, type SnapshotRow } from "../workflows/clippo-settlement/snapshot.ts";

const env = Object.fromEntries(readFileSync(new URL("./.local-chain.env", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => l.split("=") as [string, string]));
const cfg = JSON.parse(readFileSync(new URL("../workflows/clippo-settlement/config.staging.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(env.CRE_ETH_PRIVATE_KEY as Hex);
const pub = createPublicClient({ transport: http(env.RPC_URL) });
const wallet = createWalletClient({ account, transport: http(env.RPC_URL) });
const forwarderAbi = parseAbi(["function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)"]);
const escrowAbi = parseAbi([
  "function reportedViews(uint256,address) view returns (uint256)",
  "function credited(uint256,address) view returns (uint256)",
  "event ViewsReported(uint256 indexed campaignId, address indexed creator, uint256 cumulativeViews, uint256 deltaViews, uint256 credited)",
]);
const receiverAbi = parseAbi(["event ReportProcessed(uint256 items, uint256 failed)", "event ItemFailed(uint256 indexed campaignId, address indexed creator, bytes reason)"]);

const res = await fetch(`${cfg.backendUrl}${cfg.feedPath}`);
const feed = parseFrozenFeed(await res.json());
try { assertFresh(feed.day, new Date(), cfg.maxStalenessDays); } catch (e) { console.log(`REJECTED (staleness guard): ${(e as Error).message}`); process.exit(1); }
const rows = JSON.parse(normalizeSnapshot(feed.rows)) as SnapshotRow[];
console.log(`snapshot day=${feed.day} rows=${rows.length}`);
if (rows.length === 0) { console.log("no-op: empty snapshot"); process.exit(0); }

const read = async (r: SnapshotRow) => ({
  reported: await pub.readContract({ address: env.ESCROW as Hex, abi: escrowAbi, functionName: "reportedViews", args: [BigInt(r.campaignId), r.creator as Hex] }),
  credited: await pub.readContract({ address: env.ESCROW as Hex, abi: escrowAbi, functionName: "credited", args: [BigInt(r.campaignId), r.creator as Hex] }),
});
const before = await Promise.all(rows.map(read));

const header = ("0x" + "00".repeat(109)) as Hex; // 109-byte report metadata header (REPORT_METADATA_HEADER_LENGTH); the mock forwarder does not check it
const batches = chunkRows(rows, cfg.maxRowsPerReport);
for (const [i, batch] of batches.entries()) {
  const payload = encodeReport(batch).slice(2);
  const hash = await wallet.writeContract({
    chain: undefined, address: "0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1", abi: forwarderAbi, functionName: "report",
    args: [env.RECEIVER as Hex, (header + payload) as Hex, "0x", []], gas: BigInt(cfg.evm.gasLimit),
  });
  const rc = await pub.waitForTransactionReceipt({ hash });
  const logs = [...parseEventLogs({ abi: receiverAbi, logs: rc.logs }), ...parseEventLogs({ abi: escrowAbi, logs: rc.logs })];
  console.log(`batch ${i + 1}/${batches.length}: ${batch.length} rows, tx ${hash} status=${rc.status}`);
  const big = batches.length > 1;
  const shown = big ? logs.filter((l) => l.eventName !== "ViewsReported") : logs; // large run: summary only
  for (const l of shown) console.log("  ", l.eventName, JSON.stringify(l.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
const after = await Promise.all(rows.map(read));
console.log("\ncampaign creator                                    views  credited(USDC base units)");
rows.slice(0, 8).forEach((r, i) => console.log(`${r.campaignId.padStart(8)} ${r.creator} ${before[i].reported}->${after[i].reported}  ${before[i].credited}->${after[i].credited}`));

if (rows.length > 8) console.log(`... ${rows.length - 8} more rows; campaign 12 pool exhausted after the first credits (cap enforced)`);
