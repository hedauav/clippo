import { loadState, acct, chain, pub, USDC, erc20, U, fmt } from "./lib.mjs";
import { createWalletClient, http } from "viem";
const s = loadState();
const w = createWalletClient({ account: acct(process.env.UPDATER_PRIVATE_KEY), chain, transport: http(process.env.ARC_RPC_URL) });
for (const [k, amt] of [["campaigner", 8], ["creator", 0.3], ["creator2", 0.3]]) {
  const h = await w.writeContract({ address: USDC, abi: erc20, functionName: "transfer", args: [acct(s[k]).address, U(amt)] });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log(k, amt, h);
}
