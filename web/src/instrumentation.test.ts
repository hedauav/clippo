import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
import { getOverride, setOverride } from "@/lib/config";

describe("e2e test-double switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setOverride("llm", null);
  });
  it("refuses to boot with CLIPPO_E2E_DOUBLES=1 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("CLIPPO_E2E_DOUBLES", "1");
    await expect(register()).rejects.toThrow(/refused/);
    expect(() => setOverride("llm", {})).toThrow(/production/);
  });
  it("also refuses on Vercel regardless of NODE_ENV", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("CLIPPO_E2E_DOUBLES", "1");
    vi.stubEnv("VERCEL", "1");
    await expect(register()).rejects.toThrow(/refused/);
  });
  it("does nothing without the switch", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("CLIPPO_E2E_DOUBLES", "");
    await register();
    expect(getOverride("llm")).toBeUndefined();
  });
});
