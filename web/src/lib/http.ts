import { NextResponse, connection } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status });

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid request", issues: e.issues } },
      { status: 400 },
    );
  }
  console.error(e);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500 },
  );
}

/**
 * Wrap a route handler so thrown ApiError/ZodError become JSON error responses. Every API route is request-time dynamic
 * (Next 16 Cache Components): `connection()` runs OUTSIDE the try block so its prerender-interrupt signal is never
 * swallowed, which removes the "needs to bail out of prerendering" build noise.
 */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      await connection();
    } catch (e) {
      // Outside a Next request (unit tests invoking handlers directly) there is nothing to opt out of.
      if (!(e instanceof Error && /outside a request scope/.test(e.message))) throw e;
    }
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** JSON API bodies are small; larger ones are refused (uploads use their own limits). Vercel also caps function bodies at 4.5 MB. */
export const MAX_JSON_BYTES = 1_000_000;

export async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large");
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large");
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "BAD_JSON", "Request body must be valid JSON");
  }
}

/** Run a sign-in step that touches the database: anything unexpected (DB down, pool exhausted) becomes a readable 503 instead of a bare 500. */
export async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError || e instanceof ZodError) throw e;
    console.error(e);
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "The database did not answer. In development run `npm run db:local` (single connection: stop other users of it), check DATABASE_URL, then retry.");
  }
}
