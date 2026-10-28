import type { NextConfig } from "next";

const testDeploy = process.env.NEXT_PUBLIC_TEST_DEPLOY === "1";

// Report-only CSP: surfaces violations in the browser console without breaking wallets / World ID while the real origin list is learned.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.worldcoin.org https://*.world.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https://*.blob.vercel-storage.com",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://*.worldcoin.org https://*.world.org https://*.transak.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
  ...(testDeploy ? [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] : []),
];

const nextConfig: NextConfig = {
  // Optional separate build dir so a second dev server (e.g. against a scratch DB) can run beside the first.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
