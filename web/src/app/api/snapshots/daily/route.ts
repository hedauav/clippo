import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/http";
import { frozenSnapshot } from "@/lib/snapshots";

/**
 * Frozen daily feed for the Chainlink CRE workflow: { day, hash, rows } for a COMPLETED UTC day (default: yesterday).
 * Immutable once the day is over, so every CRE node reads identical bytes. `?day=YYYY-MM-DD` selects an older day.
 * `hash` is also the ETag.
 */
export const GET = route(async (req: Request) => {
  const day = new URL(req.url).searchParams.get("day") ?? undefined;
  try {
    const snap = await frozenSnapshot(day);
    return NextResponse.json(snap, { headers: { etag: `"${snap.hash}"`, "cache-control": "public, max-age=300" } });
  } catch (e) {
    if (e instanceof RangeError) throw new ApiError(400, "BAD_REQUEST", e.message);
    throw e;
  }
});
