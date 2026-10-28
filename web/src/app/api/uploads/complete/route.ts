import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { assetView } from "@/lib/source";
import { directUploadEnabled, getStorage, isValidKey } from "@/lib/storage";
import { ALLOWED_TYPES, maxUploadBytes, ownerPrefix, safeFilename, sniffVideoMime } from "@/lib/storage/files";

const body = z.object({ key: z.string().min(3).max(140), name: z.string().max(200).default("source.mp4") });

/** Finalise a direct-to-Blob upload: verify ownership, size and the real container bytes, then register the SourceAsset (idempotent). */
export const POST = route(async (req: Request) => {
  if (!directUploadEnabled()) throw new ApiError(404, "NOT_FOUND", "Direct uploads are not enabled");
  const user = await requireUser(req, ["CAMPAIGNER"]);
  await rateLimit(req, "uploads/complete", 60, 3600, user.id);
  const b = body.parse(await readJson(req));
  if (!isValidKey(b.key) || !b.key.startsWith(`${ownerPrefix(user.id)}/`)) throw new ApiError(400, "BAD_KEY", "Invalid upload key");
  const existing = await db.sourceAsset.findFirst({ where: { storageKey: b.key, ownerId: user.id } });
  if (existing) return ok({ upload: assetView(existing) });
  const storage = getStorage();
  const size = await storage.size(b.key);
  if (size == null) throw new ApiError(404, "NOT_FOUND", "Uploaded file not found in storage");
  const reject = async (status: number, code: string, msg: string) => {
    await storage.delete(b.key);
    throw new ApiError(status, code, msg);
  };
  if (size === 0) return reject(400, "EMPTY_FILE", "The file is empty");
  if (size > maxUploadBytes()) return reject(413, "FILE_TOO_LARGE", `Max upload size is ${Math.floor(maxUploadBytes() / 1024 / 1024)} MB`);
  const head = new Uint8Array(await new Response(await storage.read(b.key, { start: 0, end: 15 })).arrayBuffer());
  const mime = sniffVideoMime(head);
  if (!mime) return reject(415, "UNSUPPORTED_TYPE", "File content is not a recognised mp4, webm or mov video");
  const asset = await db.sourceAsset.create({
    data: { ownerId: user.id, kind: "UPLOAD", filename: safeFilename(b.name, ALLOWED_TYPES[mime]), storageKey: b.key, mime, size },
  });
  return ok({ upload: assetView(asset) }, 201);
});
