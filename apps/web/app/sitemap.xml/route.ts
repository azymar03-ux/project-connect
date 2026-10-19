export const dynamic = "force-dynamic";
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export async function GET() {
  const base = process.env.PUBLIC_APP_URL;
  if (!base)
    return new Response("Canonical URL not configured", { status: 503 });
  try {
    const r = await fetch(
      (process.env.INTERNAL_API_URL || "http://127.0.0.1:3001") +
        "/api/sitemaps/partitions",
      { cache: "no-store", signal: AbortSignal.timeout(10000) },
    );
    if (!r.ok) throw Error("SITEMAP_UPSTREAM");
    const partitions = await r.json();
    const urls = [
      new URL("/sitemaps/home.xml", base).href,
      ...partitions.map(
        (p: unknown) =>
          new URL(
            "/sitemaps/" +
              Buffer.from(JSON.stringify(p)).toString("base64url") +
              ".xml",
            base,
          ).href,
      ),
    ];
    if (urls.length > 50000) throw Error("SITEMAP_INDEX_LIMIT");
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        urls
          .map((url) => `<sitemap><loc>${escape(url)}</loc></sitemap>`)
          .join("") +
        "</sitemapindex>",
      {
        headers: {
          "Content-Type": "application/xml",
          "Cache-Control": "public, max-age=300",
        },
      },
    );
  } catch {
    console.error("SITEMAP_INDEX_UNAVAILABLE");
    return new Response("Sitemap temporarily unavailable", { status: 503 });
  }
}
