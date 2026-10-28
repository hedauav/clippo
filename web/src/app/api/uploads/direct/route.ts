import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { directUploadEnabled } from "@/lib/storage";
import { ALLOWED_TYPES, maxUploadBytes, ownerPrefix } from "@/lib/storage/files";

/** The browser asks this first: should it send big files straight to Vercel Blob (serverless) or through POST /api/uploads? */
export const GET = route(async () => ok({ direct: directUploadEnabled(), maxBytes: maxUploadBytes() }));

/**
 * Client-upload token endpoint for @vercel/blob/client `upload()` (videos bigger than the 4.5 MB function body limit go browser -> Blob).
 * Only a signed-in CAMPAIGNER gets a token, scoped to: video types only, <= SOURCE_MAX_BYTES, and a pathname that must look like
 * `<own user prefix>/<24 hex>.<mp4|webm|mov>` (so nobody can write into another user's namespace or overwrite anything).
 * The asset only becomes visible after POST /api/uploads/complete verifies the stored bytes.
 */
export const POST = route(async (req: Request) => {
  if (!directUploadEnabled()) throw new ApiError(404, "NOT_FOUND", "Direct uploads are not enabled (STORAGE_PROVIDER is not blob)");
  const user = await requireUser(req, ["CAMPAIGNER"]);
  await rateLimit(req, "uploads/direct", 20, 3600, user.id);
  const body = (await readJson(req)) as HandleUploadBody;
  const exts = Object.values(ALLOWED_TYPES).join("|");
  const re = new RegExp(`^${ownerPrefix(user.id)}/[a-f0-9]{24}\.(${exts})$`);
  const res = await handleUpload({
    request: req,
    body,
    onBeforeGenerateToken: async (pathname) => {
      if (!re.test(pathname)) throw new ApiError(400, "BAD_PATH", "Invalid upload path");
      return {
        allowedContentTypes: Object.keys(ALLOWED_TYPES),
        maximumSizeInBytes: maxUploadBytes(),
        addRandomSuffix: false,
        allowOverwrite: false,
      };
    },
  });
  return ok(res);
});
