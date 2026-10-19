import { sitemapPartitionSchema } from "../../../shared/api-contract";
import { z } from "zod";
export const dynamic = "force-dynamic";
const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ range: string }> },
) {
  const base = process.env.PUBLIC_APP_URL;
  if (!base)
    return new Response("Canonical URL not configured", { status: 503 });
  const name = (await params).range;
  let urls: string[];
  if (name === "home.xml") urls = [new URL("/", base).href];
  else {
    let range: z.infer<typeof sitemapPartitionSchema>;
    try {
      if (!name.endsWith(".xml") || name.length > 400) throw Error();
      range = sitemapPartitionSchema.parse(
        JSON.parse(Buffer.from(name.slice(0, -4), "base64url").toString()),
      );
    } catch {
      return new Response("Invalid sitemap range", { status: 400 });
    }
    try {
      const r = await fetch(
        (process.env.INTERNAL_API_URL || "http://127.0.0.1:3001") +
          "/api/sitemaps/entries?" +
          new URLSearchParams(range),
        { cache: "no-store", signal: AbortSignal.timeout(10000) },
      );
      if (!r.ok) throw Error("SITEMAP_UPSTREAM");
      const data = await r.json();
      urls = data.items.map(
        (p: { id: string }) =>
          new URL(
            (range.kind === "projects" ? "/projects/" : "/people/") +
              encodeURIComponent(p.id),
            base,
          ).href,
      );
    } catch {
      console.error("SITEMAP_PARTITION_UNAVAILABLE");
      return new Response("Sitemap temporarily unavailable", { status: 503 });
    }
  }
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls.map((url) => `<url><loc>${escape(url)}</loc></url>`).join("") +
      "</urlset>",
    {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
