import type { Metadata } from "next";
export async function publicMetadata(
  kind: "projects" | "people",
  id: string,
): Promise<Metadata> {
  const base = process.env.PUBLIC_APP_URL;
  const path = `/${kind}/${encodeURIComponent(id)}`;
  try {
    const response = await fetch(
      (process.env.INTERNAL_API_URL || "http://127.0.0.1:3001") +
        `/api/${kind === "people" ? "profiles" : "projects"}/${encodeURIComponent(id)}`,
      { cache: "no-store", signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok)
      return {
        title: "Unavailable — ProjectConnect",
        robots: { index: false, follow: false },
      };
    const value = await response.json(),
      title =
        (kind === "people" ? value.name : value.title) + " — ProjectConnect",
      description = (
        kind === "people" ? value.bio || value.role : value.description
      ).slice(0, 160);
    return {
      title,
      description,
      alternates: base ? { canonical: new URL(path, base).href } : undefined,
      openGraph: {
        title,
        description,
        type: "website",
        url: base ? new URL(path, base).href : undefined,
      },
    };
  } catch {
    return { title: "ProjectConnect", robots: { index: false, follow: false } };
  }
}
