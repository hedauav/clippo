import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { latestSnapshots } from "@/lib/snapshots";

/**
 * Public, read-only feed for the Chainlink CRE workflow:
 * [{campaignId, onchainId, creator, cumulativeViews}] (creator = wallet; approved clips only).
 */
export const GET = route(async () => {
  return NextResponse.json(await latestSnapshots());
});
