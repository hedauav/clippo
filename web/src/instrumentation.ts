/**
 * Next.js instrumentation hook. Installs the explicit TEST doubles for `npm run e2e:chain` (no external credentials) ONLY when
 * CLIPPO_E2E_DOUBLES=1. It is impossible in production: the server refuses to boot if the switch is set under NODE_ENV=production
 * (and `setOverride` itself also throws there). Without the switch this file does nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CLIPPO_E2E_DOUBLES !== "1") return;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new Error("CLIPPO_E2E_DOUBLES=1 is refused when NODE_ENV=production or on Vercel (test doubles must never run in production)");
  }
  const { installE2eDoubles } = await import("@/test/e2e-doubles");
  installE2eDoubles();
  console.warn("[e2e] TEST DOUBLES INSTALLED (World ID / AI / platforms / chain signer). Never use this mode in production.");
}
