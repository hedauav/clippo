/**
 * TEST DOUBLES ONLY (used by `npm run e2e:chain`). Wired in by src/instrumentation.ts when CLIPPO_E2E_DOUBLES=1, which
 * REFUSES to start under NODE_ENV=production. Same doubles as the unit tests, plus a YouTube double whose view counts and
 * "clip gone" state are driven by a JSON control file (E2E_CONTROL_FILE) that the e2e script rewrites between steps:
 *   { "views": { "<videoId>": 4000 }, "gone": ["<videoId>"] }
 */
import { readFileSync } from "node:fs";
import { setOverride } from "@/lib/config";
import { parseVideoId as ytParse } from "@/lib/youtube";
import { FakePlatform, installDoubles } from "./doubles";

type Control = { views?: Record<string, number>; gone?: string[] };

function control(): Control {
  const f = process.env.E2E_CONTROL_FILE;
  if (!f) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Control;
  } catch {
    return {};
  }
}

class ControlledYouTube extends FakePlatform {
  constructor() {
    super("YOUTUBE", ytParse);
  }
  async getViews(videoId: string) {
    const v = control().views?.[videoId];
    return typeof v === "number" ? v : super.getViews(videoId);
  }
  async availability(videoId: string) {
    return control().gone?.includes(videoId) ? ("gone" as const) : ("available" as const);
  }
}

export function installE2eDoubles() {
  if (process.env.NODE_ENV === "production") throw new Error("e2e test doubles are not allowed in production");
  installDoubles(); // llm, platforms, worldId, videoGenerator, chainSigner (the chain itself is REAL: anvil)
  setOverride("youtube", new ControlledYouTube());
}
