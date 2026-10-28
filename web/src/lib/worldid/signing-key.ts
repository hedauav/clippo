/**
 * World RP signing keys are 32-byte secp256k1 private keys as hex (64 chars), with or without a 0x prefix
 * (https://docs.world.org/world-id/idkit/signatures). Be lenient about paste noise (whitespace, one layer of
 * quotes, a "KEY=" prefix) and strict about the key itself. Errors name the problem but NEVER echo the value.
 */
export class SigningKeyFormatError extends Error {
  constructor(problem: string) {
    super(`WORLD_ID_SIGNING_KEY is invalid: ${problem}`);
    this.name = "SigningKeyFormatError";
  }
}

export function normalizeSigningKey(raw: string | undefined): string {
  let v = (raw ?? "").trim();
  if (!v) throw new SigningKeyFormatError("it is empty");
  v = v.replace(/^WORLD_ID_SIGNING_KEY\s*=\s*/, "").trim();
  if (/^(["'`]).*\1$/s.test(v)) v = v.slice(1, -1).trim();
  if (v.includes("BEGIN")) throw new SigningKeyFormatError("it looks like a PEM block; World issues a raw hex key (64 hex characters)");
  if (/\s/.test(v)) throw new SigningKeyFormatError("it contains whitespace or line breaks inside the key");
  const hex = v.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new SigningKeyFormatError(/^[A-Za-z0-9+/_-]+=*$/.test(hex) ? "it is not hex (looks base64); expected 64 hex characters" : "it contains non-hex characters (check for stray quotes or punctuation)");
  }
  if (hex.length !== 64) throw new SigningKeyFormatError(`expected 64 hex characters (32 bytes), got ${hex.length}`);
  if (/^0+$/.test(hex)) throw new SigningKeyFormatError("it is all zeros");
  return `0x${hex.toLowerCase()}`;
}
