import { newKey, acct, loadState, saveState, pub, USDC, erc20, U, fmt, chain } from "./lib.mjs";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const s = loadState();
for (const k of ["campaigner", "creator", "creator2"]) s[k] ??= newKey();
saveState(s);
const out = {};
for (const [n, k] of [["deployer", process.env.DEPLOYER_PRIVATE_KEY], ["updater", process.env.UPDATER_PRIVATE_KEY], ["admin", process.env.ADMIN_PRIVATE_KEY], ["campaigner", s.campaigner], ["creator", s.creator], ["creator2", s.creator2]]) {
  const a = acct(k).address;
  const b = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [a] });
  out[n] = { address: a, usdc: fmt(b) };
}
console.log(out);
