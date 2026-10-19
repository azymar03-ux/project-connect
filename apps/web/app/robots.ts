import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/account/"] },
    sitemap: process.env.PUBLIC_APP_URL
      ? new URL("/sitemap.xml", process.env.PUBLIC_APP_URL).href
      : undefined,
  };
}
