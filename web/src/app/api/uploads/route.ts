import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, route } from "@/lib/http";
import { assetView } from "@/lib/source";
import { rateLimit } from "@/lib/ratelimit";
import { directUploadEnabled, getStorage } from "@/lib/storage";
import { VERCEL_BODY_LIMIT, maxUploadBytes, newStorageKey, validateUpload } from "@/lib/storage/files";

/** Upload a campaign source clip (multipart `file`; optional `purpose`). Campaigner only. mp4/webm/mov, size-limited. */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const declaredLen = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLen) && declaredLen > maxUploadBytes() + 1024 * 1024) {
    throw new ApiError(413, "FILE_TOO_LARGE", `Max upload size is ${Math.floor(maxUploadBytes() / 1024 / 1024)} MB`);
  }
  // Vercel functions reject request bodies above ~4.5 MB before our code runs: larger files must use the direct-to-Blob flow.
  if (directUploadEnabled() && Number.isFinite(declaredLen) && declaredLen > VERCEL_BODY_LIMIT) {
    throw new ApiError(413, "USE_DIRECT_UPLOAD", "This file is too large for a function request; upload it directly to storage (POST /api/uploads/direct)");
  }
  await rateLimit(req, "uploads", 20, 3600, user.id);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "BAD_FORM", "Send multipart/form-data with a `file` field");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "Missing `file` field");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const v = validateUpload({ name: file.name, declaredMime: file.type, bytes });
  const key = newStorageKey(user.id, v.ext);
  await getStorage().put(key, bytes, v.mime);
  const asset = await db.sourceAsset.create({
    data: { ownerId: user.id, kind: "UPLOAD", filename: v.filename, storageKey: key, mime: v.mime, size: bytes.length },
  });
  return ok({ upload: assetView(asset) }, 201);
});
