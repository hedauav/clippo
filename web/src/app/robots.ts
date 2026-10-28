import type { MetadataRoute } from "next";

/** Test deployment (NEXT_PUBLIC_TEST_DEPLOY=1): keep crawlers out. Otherwise allow everything. */
export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_TEST_DEPLOY === "1") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/" } };
}
