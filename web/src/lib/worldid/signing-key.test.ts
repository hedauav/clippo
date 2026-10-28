import { describe, expect, it } from "vitest";
import { normalizeSigningKey } from "./signing-key";

const HEX = "ab".repeat(32);

describe("normalizeSigningKey", () => {
  it.each([
    ["bare hex", HEX],
    ["0x hex", `0x${HEX}`],
    ["0X + uppercase", `0X${HEX.toUpperCase()}`],
    ["whitespace/newline", `  0x${HEX}\r\n`],
    ["double quotes", `"0x${HEX}"`],
    ["single quotes", `'${HEX}'`],
    ["KEY= prefix", `WORLD_ID_SIGNING_KEY=${HEX}`],
  ])("accepts %s", (_n, input) => expect(normalizeSigningKey(input)).toBe(`0x${HEX}`));

  it.each([
    ["empty", undefined, /empty/],
    ["short", "ab".repeat(31), /got 62/],
    ["long", "ab".repeat(33), /got 66/],
    ["non-hex", `${"z".repeat(64)}`, /non-hex|base64/],
    ["base64", "q83vEjRWeJCrze8SNFZ4kKvN7xI0VniQq83vEjRWeJA=", /base64/],
    ["PEM", "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", /PEM/],
    ["inner whitespace", `${"ab".repeat(16)} ${"ab".repeat(16)}`, /whitespace/],
    ["zeros", "0".repeat(64), /zeros/],
  ])("rejects %s without echoing the value", (_n, input, re) => {
    let msg = "";
    try { normalizeSigningKey(input); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(re);
    if (input && input.length > 8) expect(msg).not.toContain(input.slice(0, 8));
  });
});
