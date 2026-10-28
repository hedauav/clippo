import { NextResponse } from "next/server";
import { publicChainConfig } from "@/lib/chain/config";
import { getPlatformFees } from "@/lib/chain/fees";
import { route } from "@/lib/http";

/** Public chain + fee configuration for wallet clients (no secrets). Fees are read from the escrow when configured. */
export const GET = route(async () => {
  return NextResponse.json({ chain: publicChainConfig(), fees: await getPlatformFees() });
});
