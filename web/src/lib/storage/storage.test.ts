import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../http";
import { LocalDiskStorage, isValidKey } from "./index";
import { newStorageKey, parseRange, safeFilename, sniffVideoMime, validateUpload } from "./files";

const mp4 = (n = 64) => {
  const b = new Uint8Array(n);
  b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  return b;
};
const webm = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);

afterEach(() => vi.unstubAllEnvs());

describe("safeFilename", () => {
  it("strips paths and odd characters", () => {
    expect(safeFilename("../../etc/passwd.mp4")).toBe("passwd.mp4");
    expect(safeFilename("C:\\x\\my clip!!<script>.MP4")).toBe("my clipscript.mp4");
    expect(safeFilename("...")).toBe("source.mp4");
    expect(safeFilename("a".repeat(300) + ".webm").length).toBeLessThanOrEqual(86);
  });
  it("storage keys are server-generated and valid", () => {
    const k = newStorageKey("user_123", "mp4");
    expect(isValidKey(k)).toBe(true);
    expect(isValidKey("../x/y.mp4")).toBe(false);
    expect(isValidKey("a/b/c.mp4")).toBe(false);
    expect(isValidKey("a/..%2f.mp4")).toBe(false);
  });
});

describe("validateUpload", () => {
  it("accepts mp4 / webm / quicktime", () => {
    expect(validateUpload({ name: "a.mp4", declaredMime: "video/mp4", bytes: mp4() })).toMatchObject({ mime: "video/mp4", ext: "mp4" });
    expect(validateUpload({ name: "a.webm", declaredMime: "video/webm", bytes: webm() }).ext).toBe("webm");
  });
  it("rejects wrong type, spoofed content, empty and oversize", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as ApiError).code;
      }
      return null;
    };
    expect(code(() => validateUpload({ name: "a.exe", declaredMime: "application/x-msdownload", bytes: mp4() }))).toBe("UNSUPPORTED_TYPE");
    expect(code(() => validateUpload({ name: "a.mp4", declaredMime: "video/mp4", bytes: new TextEncoder().encode("<html>not a video</html>") }))).toBe("UNSUPPORTED_TYPE");
    expect(code(() => validateUpload({ name: "a.mp4", declaredMime: "video/webm", bytes: mp4() }))).toBe("TYPE_MISMATCH");
    expect(code(() => validateUpload({ name: "a.mp4", declaredMime: "video/mp4", bytes: new Uint8Array() }))).toBe("EMPTY_FILE");
    vi.stubEnv("SOURCE_MAX_BYTES", "32");
    expect(code(() => validateUpload({ name: "a.mp4", declaredMime: "video/mp4", bytes: mp4(64) }))).toBe("FILE_TOO_LARGE");
  });
  it("sniffs containers", () => {
    expect(sniffVideoMime(mp4())).toBe("video/mp4");
    expect(sniffVideoMime(new Uint8Array(20))).toBeNull();
  });
});

describe("parseRange", () => {
  it("handles open, closed, suffix and bad ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("garbage", 100)).toBeNull();
  });
});

describe("LocalDiskStorage", () => {
  it("round-trips, supports ranges, refuses overwrite and traversal", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "clippo-"));
    try {
      const s = new LocalDiskStorage(dir);
      const key = newStorageKey("u1", "mp4");
      await s.put(key, new Uint8Array([1, 2, 3, 4, 5]));
      expect(await s.size(key)).toBe(5);
      const text = async (st: ReadableStream<Uint8Array>) => [...new Uint8Array(await new Response(st).arrayBuffer())];
      expect(await text(await s.read(key))).toEqual([1, 2, 3, 4, 5]);
      expect(await text(await s.read(key, { start: 1, end: 2 }))).toEqual([2, 3]);
      await expect(s.put(key, new Uint8Array([9]))).rejects.toThrow();
      await expect(s.read("../../etc/passwd")).rejects.toThrow();
      await s.delete(key);
      expect(await s.size(key)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
