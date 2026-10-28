import { randomBytes } from "node:crypto";
import { ApiError } from "../http";

/** Vercel Functions reject request bodies above 4.5 MB; stay under it for multipart uploads through a route. */
export const VERCEL_BODY_LIMIT = 4_400_000;

/** Allowed source-clip types: mime -> extension. */
export const ALLOWED_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const maxUploadBytes = () => {
  const n = Number(process.env.SOURCE_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 500 * 1024 * 1024;
};

/** Display-safe filename: no path parts, control chars or odd symbols; bounded length. Never used as a storage path. */
export function safeFilename(name: string, fallbackExt = "mp4"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).normalize("NFKD").replace(/[^A-Za-z0-9._ -]+/g, "").replace(/\.{2,}/g, ".").replace(/^[.\s-]+|[.\s]+$/g, "").slice(0, 80);
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) : "";
  return `${stem || "source"}.${ext || fallbackExt}`;
}

/** Directory segment of every key an owner may write. */
export const ownerPrefix = (ownerId: string) => ownerId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "anon";

export const newStorageKey = (ownerId: string, ext: string) => `${ownerPrefix(ownerId)}/${randomBytes(12).toString("hex")}.${ext}`;

/** Container sniffing so a renamed non-video cannot slip through on a spoofed Content-Type. */
export function sniffVideoMime(b: Uint8Array): string | null {
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return null;
}

export interface ValidatedUpload {
  mime: string;
  ext: string;
  filename: string;
}

/** Throws ApiError(400/413/415). `declaredMime` comes from the client and is only a cross-check. */
export function validateUpload(input: { name: string; declaredMime: string; bytes: Uint8Array }): ValidatedUpload {
  if (input.bytes.length === 0) throw new ApiError(400, "EMPTY_FILE", "The file is empty");
  if (input.bytes.length > maxUploadBytes()) {
    throw new ApiError(413, "FILE_TOO_LARGE", `Max upload size is ${Math.floor(maxUploadBytes() / 1024 / 1024)} MB`);
  }
  const declared = input.declaredMime.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES[declared]) throw new ApiError(415, "UNSUPPORTED_TYPE", `Allowed types: ${Object.keys(ALLOWED_TYPES).join(", ")}`);
  const sniffed = sniffVideoMime(input.bytes);
  if (!sniffed) throw new ApiError(415, "UNSUPPORTED_TYPE", "File content is not a recognised mp4, webm or mov video");
  // mp4/mov share a container family; only reject webm <-> mp4 family mismatches.
  if ((sniffed === "video/webm") !== (declared === "video/webm")) {
    throw new ApiError(415, "TYPE_MISMATCH", "File content does not match its declared type");
  }
  return { mime: sniffed, ext: ALLOWED_TYPES[sniffed], filename: safeFilename(input.name, ALLOWED_TYPES[sniffed]) };
}

/** Parse a `Range: bytes=a-b` header against a file size. null = no/invalid range; "unsatisfiable" for 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
