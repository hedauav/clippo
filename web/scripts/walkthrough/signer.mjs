// Local signing service for the walkthrough: keys stay in this Node process; the page's injected provider calls it over 127.0.0.1.
import http from "node:http";
import { createWalletClient, http as vhttp } from "viem";
import { loadState, chain, pub, acct } from "./lib.mjs";
const s = loadState();
const keys = { admin: process.env.ADMIN_PRIVATE_KEY, campaigner: s.campaigner, creator: s.creator, creator2: s.creator2 };
const wc = {}, ac = {};
for (const [r, k] of Object.entries(keys)) { ac[r] = acct(k); wc[r] = createWalletClient({ account: ac[r], chain, transport: vhttp(process.env.ARC_RPC_URL) }); }
const PORT = Number(process.env.SIGNER_PORT ?? 3499);
http.createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-private-network": "true", "access-control-allow-methods": "POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let body = ""; for await (const c of req) body += c;
  try {
    const { role, method, params } = JSON.parse(body);
    const a = ac[role]; if (!a) throw new Error("unknown role");
    let result;
    if (method === "personal_sign") { const m = params[0]; result = await a.signMessage({ message: m.startsWith("0x") ? Buffer.from(m.slice(2), "hex").toString("utf8") : m }); }
    else if (method === "eth_sendTransaction") { const t = params[0]; result = await wc[role].sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined, gas: t.gas ? BigInt(t.gas) : undefined }); console.log(role, "tx", result); }
    else if (method === "eth_requestAccounts" || method === "eth_accounts") result = [a.address];
    else if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain" || method === "wallet_requestPermissions") result = null;
    else if (method === "eth_chainId") result = "0x" + chain.id.toString(16);
    else if (method === "net_version") result = String(chain.id);
    else result = await pub.request({ method, params });
    res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ result }));
  } catch (e) { res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: e?.code ?? -32000, message: String(e?.shortMessage ?? e?.message ?? e).slice(0, 300) } })); }
}).listen(PORT, "127.0.0.1", () => console.log("signer up", PORT));
