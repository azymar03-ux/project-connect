import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: [
    "localhost",
    ...(process.env.E2B_SANDBOX_ID
      ? [`3000-${process.env.E2B_SANDBOX_ID}.e2b.app`]
      : []),
    ...(process.env.PUBLIC_APP_URL
      ? [new URL(process.env.PUBLIC_APP_URL).hostname]
      : []),
  ],
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    const preview =
      process.env.PC_SANDBOX_PREVIEW === "true" &&
      Boolean(process.env.E2B_SANDBOX_ID);
    const ancestors = preview
      ? "'self' https://arena.ai https://*.arena.ai"
      : "'self'";
    const google =
      "https://*.googleapis.com https://*.gstatic.com https://*.google.com";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=()" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors ${ancestors}; form-action 'self'; script-src 'self' 'unsafe-inline' ${google}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: ${google}; connect-src 'self' ${google}; font-src 'self' https://fonts.gstatic.com; worker-src 'self' blob:; frame-src 'self' https://www.google.com`,
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination:
          (process.env.INTERNAL_API_URL || "http://127.0.0.1:3001") +
          "/api/:path*",
      },
    ];
  },
};
export default config;
