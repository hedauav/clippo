import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { del, get, head, put } from "@vercel/blob";

/**
 * Storage abstraction. Selected by env (see getStorage):
 *  - local: web/storage on disk (development, `next start` on a VM with a persistent volume). NOT usable on Vercel.
 *  - blob:  Vercel Blob PRIVATE store (serverless; objects are never publicly addressable, every read goes through an
 *           authorised API route that streams the bytes, so campaign-visibility rules in source.ts keep applying).
 */
export interface StorageProvider {
  readonly name: "local" | "blob";
  put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
  size(key: string): Promise<number | null>;
  /** Web ReadableStream for an inclusive byte range (whole file when omitted). */
  read(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
}

/** Keys are server-generated: `<segment>/<segment>.<ext>`; anything else is refused (no traversal, no user text). */
const KEY_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\.[a-z0-9]{2,5}$/;
export const isValidKey = (k: string) => KEY_RE.test(k);

export class LocalDiskStorage implements StorageProvider {
  readonly name = "local" as const;
  private root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string) {
    if (!isValidKey(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Uint8Array) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: "wx" });
  }

  async size(key: string) {
    try {
      return (await stat(this.resolve(key))).size;
    } catch {
      return null;
    }
  }

  async read(key: string, range?: { start: number; end: number }) {
    const stream = createReadStream(this.resolve(key), range ? { start: range.start, end: range.end } : undefined);
    return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/** Keep only bytes [start, end] of a stream (used when the origin ignored our Range header and sent the whole object). */
function sliceStream(src: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = src.getReader();
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || pos > end) {
          ctl.close();
          void reader.cancel().catch(() => {});
          return;
        }
        const chunkStart = pos;
        pos += value.length;
        if (pos <= start) continue;
        ctl.enqueue(value.subarray(Math.max(0, start - chunkStart), Math.min(value.length, end + 1 - chunkStart)));
        if (pos > end) {
          ctl.close();
          void reader.cancel().catch(() => {});
        }
        return;
      }
    },
    cancel: () => reader.cancel(),
  });
}

/** Vercel Blob (private store). Auth: OIDC + BLOB_STORE_ID (default for a connected store) or BLOB_READ_WRITE_TOKEN. */
export class BlobStorage implements StorageProvider {
  readonly name = "blob" as const;

  async put(key: string, data: Uint8Array, contentType?: string) {
    if (!isValidKey(key)) throw new Error("Invalid storage key");
    await put(key, Buffer.from(data), { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType, multipart: data.length > 20 * 1024 * 1024 });
  }

  async size(key: string) {
    if (!isValidKey(key)) return null;
    try {
      return (await head(key)).size;
    } catch {
      return null;
    }
  }

  async read(key: string, range?: { start: number; end: number }) {
    if (!isValidKey(key)) throw new Error("Invalid storage key");
    const r = await get(key, { access: "private", ...(range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {}) });
    if (!r || r.statusCode !== 200) throw new Error("Blob not found");
    if (!range) return r.stream;
    // 206 => the origin already cut the range; 200 => it ignored Range, so cut it here.
    return r.headers.get("content-range") ? r.stream : sliceStream(r.stream, range.start, range.end);
  }

  async delete(key: string) {
    if (!isValidKey(key)) return;
    await del(key).catch(() => {});
  }
}

const onVercel = () => !!process.env.VERCEL;
const hasBlobAuth = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

/** Which provider is active. STORAGE_PROVIDER=local|blob wins; otherwise blob when Blob credentials exist or on Vercel, else local. */
export function storageMode(): "local" | "blob" {
  const wanted = (process.env.STORAGE_PROVIDER ?? "").trim().toLowerCase();
  if (wanted === "local" || wanted === "blob") return wanted;
  return hasBlobAuth() || onVercel() ? "blob" : "local";
}

/** True when the browser may upload straight to Blob (needed for videos above the ~4.5 MB Vercel function body limit). */
export const directUploadEnabled = () => storageMode() === "blob" && hasBlobAuth();

let cached: StorageProvider | undefined;
export function getStorage(): StorageProvider {
  if (cached) return cached;
  const mode = storageMode();
  if (mode === "local" && onVercel()) {
    throw new Error("Local-disk storage cannot be used on Vercel (read-only/ephemeral filesystem): create a private Vercel Blob store and set STORAGE_PROVIDER=blob");
  }
  cached = mode === "blob" ? new BlobStorage() : new LocalDiskStorage(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
  return cached;
}

/** Test hook. */
export function resetStorageForTests() {
  cached = undefined;
}
