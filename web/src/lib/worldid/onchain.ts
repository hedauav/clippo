import { createPublicClient, http, keccak256, toBytes, type Address } from "viem";
import { env, notConfigured } from "../config";
import { isIdkitResult, type IdkitResult, type WorldIdProof } from "./index";

/**
 * OPTIONAL second check: re-verify a World ID 4.0 uniqueness proof against the on-chain WorldIDVerifier / WorldIDSatellite
 * (docs.world.org/world-id/idkit/onchain-verification). Off unless WORLD_ID_ONCHAIN_VERIFIER and WORLD_ID_ONCHAIN_RPC_URL are set.
 * Known addresses: World Chain prod 0x00000000009E00F9FE82CfeeBB4556686da094d7, World Chain staging 0x703a6316c975DEabF30b637c155edD53e24657DB,
 * Arc prod (WorldIDSatellite) 0x304E14e4dC0508C0927e3b307a2C18422C07E394. The ABI below is transcribed from the docs' signature; verify it
 * against a real deployment before relying on it (see docs/tracks/WORLD_IDKIT.md).
 */
export const WORLD_ID_VERIFIER_ABI = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "nullifier", type: "uint256" },
      { name: "action", type: "uint256" },
      { name: "rpId", type: "uint64" },
      { name: "nonce", type: "uint256" },
      { name: "signalHash", type: "uint256" },
      { name: "expiresAtMin", type: "uint64" },
      { name: "issuerSchemaId", type: "uint64" },
      { name: "credentialGenesisIssuedAtMin", type: "uint256" },
      { name: "zeroKnowledgeProof", type: "uint256[5]" },
    ],
    outputs: [],
  },
] as const;

/** uint256(keccak256(bytes(action))) >> 8 (the unreduced hash can exceed the field and revert PublicInputNotInField). */
export const onchainAction = (action: string) => BigInt(keccak256(toBytes(action))) >> 8n;

/** "rp_0123abcd..." -> numeric id (hex digits after the prefix). */
export function rpIdToBigInt(rpId: string): bigint {
  const hex = rpId.replace(/^rp_/, "");
  if (!/^[0-9a-f]+$/i.test(hex)) throw new Error(`rp id is not hex: ${rpId}`);
  return BigInt("0x" + hex);
}

/** Map an IDKit 4.0 uniqueness result to the verifier's call arguments. Throws if the result is not a 4.0 uniqueness proof. */
export function toOnchainArgs(r: IdkitResult, rpId: string, action: string, genesisIssuedAtMin = 0n) {
  const resp = r.responses.find((x) => Array.isArray(x.proof) && x.proof.length === 5 && x.nullifier);
  if (!resp || !r.nonce) throw new Error("not a World ID 4.0 uniqueness proof (no 5-element proof / nonce)");
  const n = (v: unknown) => BigInt(v as string | number | bigint);
  return [
    n(resp.nullifier),
    onchainAction(action),
    rpIdToBigInt(rpId),
    n(r.nonce),
    n(resp.signal_hash ?? "0x0"),
    n(resp.expires_at_min ?? 0),
    n(resp.issuer_schema_id ?? 0),
    genesisIssuedAtMin,
    (resp.proof as unknown[]).map(n) as [bigint, bigint, bigint, bigint, bigint],
  ] as const;
}

export const onchainEnabled = () => !!env("WORLD_ID_ONCHAIN_VERIFIER");

/** Resolves true when the contract accepts the proof (a view call that reverts on failure). Legacy proofs cannot be checked this way. */
export async function verifyOnChain(proof: WorldIdProof, rpId: string, action: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isIdkitResult(proof)) return { ok: false, reason: "On-chain verification needs a World ID 4.0 proof" };
  const address = env("WORLD_ID_ONCHAIN_VERIFIER") as Address | undefined;
  const rpc = env("WORLD_ID_ONCHAIN_RPC_URL");
  if (!address || !rpc) throw notConfigured("On-chain World ID verification", "WORLD_ID_ONCHAIN_VERIFIER", "WORLD_ID_ONCHAIN_RPC_URL");
  let args;
  try {
    args = toOnchainArgs(proof, rpId, action);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  try {
    await createPublicClient({ transport: http(rpc) }).readContract({ address, abi: WORLD_ID_VERIFIER_ABI, functionName: "verify", args: args as never });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `On-chain verifier rejected the proof: ${(e as Error).message.split("\n")[0]}` };
  }
}
